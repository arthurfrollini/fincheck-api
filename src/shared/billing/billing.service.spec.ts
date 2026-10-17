jest.mock('@shared/config/env', () => ({
  env: {
    stripeSecretKey: 'sk_test_fake',
    stripePriceGold: 'price_gold',
    stripePricePlatinum: 'price_platinum',
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { BillingService } from './billing.service';
import { UsersRepository } from '@modules/users/domain/repositories/users.repository';
import { STRIPE_CLIENT } from './stripe.provider';
import { objectContaining } from '../../../test/helpers/match';
import { mock, mockReset } from 'jest-mock-extended';
import Stripe from 'stripe';
import { userRow } from '../../../test/helpers/prisma-rows';
import { stripeMethod } from '../../../test/helpers/stripe';

const stripe = {
  customers: {
    create: stripeMethod<Stripe['customers']['create']>(),
    retrieve: stripeMethod<Stripe['customers']['retrieve']>(),
    update: stripeMethod<Stripe['customers']['update']>(),
  },
  setupIntents: { create: stripeMethod<Stripe['setupIntents']['create']>() },
  subscriptions: {
    create: stripeMethod<Stripe['subscriptions']['create']>(),
    list: stripeMethod<Stripe['subscriptions']['list']>(),
    update: stripeMethod<Stripe['subscriptions']['update']>(),
  },
  paymentMethods: {
    attach: stripeMethod<Stripe['paymentMethods']['attach']>(),
  },
};

const mockUsersRepository = mock<UsersRepository>();

const ACTIVE_SUB = {
  id: 'sub_1',
  items: { data: [{ id: 'si_1', price: { id: 'price_gold' } }] },
};

const baseUser = userRow({
  id: 'user_1',
  email: 'test@example.com',
  name: 'Test User',
});

describe('BillingService', () => {
  let service: BillingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockReset(mockUsersRepository);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: UsersRepository, useValue: mockUsersRepository },
        { provide: STRIPE_CLIENT, useValue: stripe },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
  });

  // ──────────────────────────────────────────────
  // createSetupIntent
  // ──────────────────────────────────────────────

  describe('createSetupIntent', () => {
    it('creates new Stripe customer when user has no stripeCustomerId, saves it, returns clientSecret', async () => {
      mockUsersRepository.findById.mockResolvedValue({
        ...baseUser,
        stripeCustomerId: null,
      });
      stripe.customers.create.mockResolvedValue({ id: 'cus_new' });
      stripe.setupIntents.create.mockResolvedValue({
        client_secret: 'seti_secret',
      });

      const result = await service.createSetupIntent('user_1');

      expect(stripe.customers.create).toHaveBeenCalledWith({
        email: baseUser.email,
        name: baseUser.name,
        metadata: { userId: 'user_1' },
      });
      expect(mockUsersRepository.update).toHaveBeenCalledWith('user_1', {
        stripeCustomerId: 'cus_new',
      });
      expect(result).toEqual({ clientSecret: 'seti_secret' });
    });

    it('uses existing stripeCustomerId when present, returns clientSecret', async () => {
      mockUsersRepository.findById.mockResolvedValue({
        ...baseUser,
        stripeCustomerId: 'cus_existing',
      });
      stripe.setupIntents.create.mockResolvedValue({
        client_secret: 'seti_secret2',
      });

      const result = await service.createSetupIntent('user_1');

      expect(stripe.customers.create).not.toHaveBeenCalled();
      expect(result).toEqual({ clientSecret: 'seti_secret2' });
    });

    it('fails loudly when Stripe returns no client secret', async () => {
      mockUsersRepository.findById.mockResolvedValue({
        ...baseUser,
        stripeCustomerId: 'cus_existing',
      });
      stripe.setupIntents.create.mockResolvedValue({ client_secret: null });

      await expect(service.createSetupIntent('user_1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // ──────────────────────────────────────────────
  // createSubscription
  // ──────────────────────────────────────────────

  describe('createSubscription', () => {
    it('throws BadRequestException when user has no stripeCustomerId', async () => {
      mockUsersRepository.findById.mockResolvedValue({
        ...baseUser,
        stripeCustomerId: null,
      });

      await expect(
        service.createSubscription('user_1', 'GOLD'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when Stripe customer is deleted', async () => {
      mockUsersRepository.findById.mockResolvedValue({
        ...baseUser,
        stripeCustomerId: 'cus_1',
      });
      stripe.customers.retrieve.mockResolvedValue({ deleted: true });

      await expect(
        service.createSubscription('user_1', 'GOLD'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when customer has no default payment method', async () => {
      mockUsersRepository.findById.mockResolvedValue({
        ...baseUser,
        stripeCustomerId: 'cus_1',
      });
      stripe.customers.retrieve.mockResolvedValue({
        invoice_settings: { default_payment_method: null },
      });

      await expect(
        service.createSubscription('user_1', 'GOLD'),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates subscription with GOLD priceId and saves stripePriceId', async () => {
      mockUsersRepository.findById.mockResolvedValue({
        ...baseUser,
        stripeCustomerId: 'cus_1',
      });
      stripe.customers.retrieve.mockResolvedValue({
        invoice_settings: { default_payment_method: 'pm_1' },
      });
      stripe.subscriptions.create.mockResolvedValue({});

      await service.createSubscription('user_1', 'GOLD');

      expect(stripe.subscriptions.create).toHaveBeenCalledWith(
        objectContaining({
          customer: 'cus_1',
          items: [{ price: 'price_gold' }],
          default_payment_method: 'pm_1',
        }),
      );
      expect(mockUsersRepository.update).toHaveBeenCalledWith('user_1', {
        stripePriceId: 'price_gold',
      });
    });

    it('uses the id of an expanded default payment method', async () => {
      mockUsersRepository.findById.mockResolvedValue({
        ...baseUser,
        stripeCustomerId: 'cus_1',
      });
      stripe.customers.retrieve.mockResolvedValue({
        invoice_settings: {
          default_payment_method: {
            id: 'pm_expanded',
            object: 'payment_method',
          },
        },
      });
      stripe.subscriptions.create.mockResolvedValue({});

      await service.createSubscription('user_1', 'GOLD');

      expect(stripe.subscriptions.create).toHaveBeenCalledWith(
        objectContaining({ default_payment_method: 'pm_expanded' }),
      );
    });
  });

  // ──────────────────────────────────────────────
  // changePlan
  // ──────────────────────────────────────────────

  describe('changePlan', () => {
    it('throws BadRequestException when user has no stripeCustomerId', async () => {
      mockUsersRepository.findById.mockResolvedValue({
        ...baseUser,
        stripeCustomerId: null,
      });

      await expect(service.changePlan('user_1', 'FREE')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('sets cancel_at_period_end: true when newPlanId is FREE', async () => {
      mockUsersRepository.findById.mockResolvedValue({
        ...baseUser,
        stripeCustomerId: 'cus_1',
      });
      stripe.subscriptions.list.mockResolvedValue({ data: [ACTIVE_SUB] });

      await service.changePlan('user_1', 'FREE');

      expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', {
        cancel_at_period_end: true,
      });
      expect(mockUsersRepository.update).not.toHaveBeenCalled();
    });

    it('updates subscription with proration always_invoice for GOLD→PLATINUM upgrade', async () => {
      mockUsersRepository.findById.mockResolvedValue({
        ...baseUser,
        stripeCustomerId: 'cus_1',
        stripePriceId: 'price_gold',
      });
      stripe.subscriptions.list.mockResolvedValue({ data: [ACTIVE_SUB] });
      stripe.subscriptions.update.mockResolvedValue({});

      await service.changePlan('user_1', 'PLATINUM');

      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        'sub_1',
        objectContaining({
          proration_behavior: 'always_invoice',
          items: [{ id: 'si_1', price: 'price_platinum' }],
        }),
      );
      expect(mockUsersRepository.update).toHaveBeenCalledWith('user_1', {
        stripePriceId: 'price_platinum',
      });
    });

    it('updates subscription with proration none for PLATINUM→GOLD downgrade', async () => {
      mockUsersRepository.findById.mockResolvedValue({
        ...baseUser,
        stripeCustomerId: 'cus_1',
        stripePriceId: 'price_platinum',
      });
      stripe.subscriptions.list.mockResolvedValue({ data: [ACTIVE_SUB] });
      stripe.subscriptions.update.mockResolvedValue({});

      await service.changePlan('user_1', 'GOLD');

      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        'sub_1',
        objectContaining({
          proration_behavior: 'none',
          items: [{ id: 'si_1', price: 'price_gold' }],
        }),
      );
    });
  });

  // ──────────────────────────────────────────────
  // cancelSubscription
  // ──────────────────────────────────────────────

  describe('cancelSubscription', () => {
    it('throws BadRequestException when user has no stripeCustomerId', async () => {
      mockUsersRepository.findById.mockResolvedValue({
        ...baseUser,
        stripeCustomerId: null,
      });

      await expect(service.cancelSubscription('user_1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('calls subscriptions.update with cancel_at_period_end: true', async () => {
      mockUsersRepository.findById.mockResolvedValue({
        ...baseUser,
        stripeCustomerId: 'cus_1',
      });
      stripe.subscriptions.list.mockResolvedValue({ data: [ACTIVE_SUB] });
      stripe.subscriptions.update.mockResolvedValue({});

      await service.cancelSubscription('user_1');

      expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', {
        cancel_at_period_end: true,
      });
    });
  });

  // ──────────────────────────────────────────────
  // createCustomerAndSubscribe
  // ──────────────────────────────────────────────

  describe('createCustomerAndSubscribe', () => {
    it('attaches payment method, sets as default, creates subscription, saves stripePriceId', async () => {
      mockUsersRepository.findById.mockResolvedValue({
        ...baseUser,
        stripeCustomerId: null,
      });
      stripe.customers.create.mockResolvedValue({ id: 'cus_new' });
      stripe.paymentMethods.attach.mockResolvedValue({});
      stripe.customers.update.mockResolvedValue({});
      stripe.subscriptions.create.mockResolvedValue({});

      await service.createCustomerAndSubscribe('user_1', 'pm_test', 'GOLD');

      expect(stripe.paymentMethods.attach).toHaveBeenCalledWith('pm_test', {
        customer: 'cus_new',
      });
      expect(stripe.customers.update).toHaveBeenCalledWith('cus_new', {
        invoice_settings: { default_payment_method: 'pm_test' },
      });
      expect(stripe.subscriptions.create).toHaveBeenCalledWith(
        objectContaining({
          customer: 'cus_new',
          items: [{ price: 'price_gold' }],
          default_payment_method: 'pm_test',
        }),
      );
      expect(mockUsersRepository.update).toHaveBeenCalledWith('user_1', {
        stripePriceId: 'price_gold',
      });
    });
  });
});
