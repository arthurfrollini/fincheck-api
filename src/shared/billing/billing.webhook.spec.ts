jest.mock('@shared/config/env', () => ({
  env: {
    stripePriceGold: 'price_gold',
    stripePricePlatinum: 'price_platinum',
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import Stripe from 'stripe';
import { getLoggerToken } from 'nestjs-pino';
import { BillingWebhookHandler } from './billing.webhook';
import { UsersRepository } from '@modules/users/domain/repositories/users.repository';
import { MailQueueService } from '@shared/mail/mail-queue.service';
import { StripeEventsRepository } from './stripe-events.repository';
import { Plan } from '@modules/users/entities/User';

const mockUsersRepository = {
  findByStripeCustomerId: jest.fn(),
  update: jest.fn(),
};

const mockMailQueueService = {
  queueDowngradeNotification: jest.fn(),
  queueSubscriptionCancelled: jest.fn(),
};

const mockStripeEventsRepository = {
  register: jest.fn(),
  unregister: jest.fn(),
};

const mockLogger = {
  error: jest.fn(),
};

const makeEvent = (
  type: string,
  object: Record<string, unknown>,
): Stripe.Event => ({ type, data: { object } }) as unknown as Stripe.Event;

const baseUser = {
  id: 'user_1',
  name: 'Test User',
  email: 'test@example.com',
  plan: Plan.FREE as Plan,
  stripeCustomerId: 'cus_test',
};

describe('BillingWebhookHandler', () => {
  let handler: BillingWebhookHandler;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingWebhookHandler,
        { provide: UsersRepository, useValue: mockUsersRepository },
        { provide: MailQueueService, useValue: mockMailQueueService },
        {
          provide: StripeEventsRepository,
          useValue: mockStripeEventsRepository,
        },
        {
          provide: getLoggerToken(BillingWebhookHandler.name),
          useValue: mockLogger,
        },
      ],
    }).compile();

    handler = module.get<BillingWebhookHandler>(BillingWebhookHandler);

    mockStripeEventsRepository.register.mockResolvedValue(true);
    mockStripeEventsRepository.unregister.mockResolvedValue(undefined);
  });

  describe('handle — invoice.payment_succeeded', () => {
    const makeInvoice = (customer: string, price: unknown) => ({
      customer,
      lines: {
        data: [
          {
            pricing: {
              price_details: {
                price,
              },
            },
          },
        ],
      },
    });

    it('returns early when user not found for customerId', async () => {
      mockUsersRepository.findByStripeCustomerId.mockResolvedValue(null);
      const event = makeEvent(
        'invoice.payment_succeeded',
        makeInvoice('cus_unknown', 'price_gold'),
      );
      await handler.handle(event);
      expect(mockUsersRepository.update).not.toHaveBeenCalled();
    });

    it('returns early when priceId missing from invoice line item', async () => {
      mockUsersRepository.findByStripeCustomerId.mockResolvedValue({
        ...baseUser,
      });
      const event = makeEvent('invoice.payment_succeeded', {
        customer: 'cus_test',
        lines: { data: [{ pricing: { price_details: { price: null } } }] },
      });
      await handler.handle(event);
      expect(mockUsersRepository.update).not.toHaveBeenCalled();
    });

    it('updates user.plan = GOLD when priceId matches GOLD (string price)', async () => {
      mockUsersRepository.findByStripeCustomerId.mockResolvedValue({
        ...baseUser,
        plan: Plan.FREE,
      });
      mockUsersRepository.update.mockResolvedValue({});
      const event = makeEvent(
        'invoice.payment_succeeded',
        makeInvoice('cus_test', 'price_gold'),
      );
      await handler.handle(event);
      expect(mockUsersRepository.update).toHaveBeenCalledWith('user_1', {
        plan: Plan.GOLD,
      });
    });

    it('updates user.plan = PLATINUM when priceId matches PLATINUM (object price with id)', async () => {
      mockUsersRepository.findByStripeCustomerId.mockResolvedValue({
        ...baseUser,
        plan: Plan.FREE,
      });
      mockUsersRepository.update.mockResolvedValue({});
      const event = makeEvent(
        'invoice.payment_succeeded',
        makeInvoice('cus_test', { id: 'price_platinum' }),
      );
      await handler.handle(event);
      expect(mockUsersRepository.update).toHaveBeenCalledWith('user_1', {
        plan: Plan.PLATINUM,
      });
    });

    it('sends downgrade email when PLATINUM→GOLD', async () => {
      mockUsersRepository.findByStripeCustomerId.mockResolvedValue({
        ...baseUser,
        plan: Plan.PLATINUM,
      });
      mockUsersRepository.update.mockResolvedValue({});
      const event = makeEvent(
        'invoice.payment_succeeded',
        makeInvoice('cus_test', 'price_gold'),
      );
      await handler.handle(event);
      expect(mockMailQueueService.queueDowngradeNotification).toHaveBeenCalledWith(
        baseUser.email,
        baseUser.name,
        Plan.GOLD,
      );
    });

    it('does NOT send downgrade email on first payment (FREE→GOLD)', async () => {
      mockUsersRepository.findByStripeCustomerId.mockResolvedValue({
        ...baseUser,
        plan: Plan.FREE,
      });
      mockUsersRepository.update.mockResolvedValue({});
      const event = makeEvent(
        'invoice.payment_succeeded',
        makeInvoice('cus_test', 'price_gold'),
      );
      await handler.handle(event);
      expect(mockMailQueueService.queueDowngradeNotification).not.toHaveBeenCalled();
    });
  });

  describe('handle — customer.subscription.deleted', () => {
    it('returns early when user not found', async () => {
      mockUsersRepository.findByStripeCustomerId.mockResolvedValue(null);
      const event = makeEvent('customer.subscription.deleted', {
        customer: 'cus_unknown',
      });
      await handler.handle(event);
      expect(mockUsersRepository.update).not.toHaveBeenCalled();
      expect(mockMailQueueService.queueSubscriptionCancelled).not.toHaveBeenCalled();
    });

    it('sets plan FREE, stripePriceId null and sends cancellation email', async () => {
      mockUsersRepository.findByStripeCustomerId.mockResolvedValue({
        ...baseUser,
        plan: Plan.GOLD,
      });
      mockUsersRepository.update.mockResolvedValue({});
      const event = makeEvent('customer.subscription.deleted', {
        customer: 'cus_test',
      });
      await handler.handle(event);
      expect(mockUsersRepository.update).toHaveBeenCalledWith('user_1', {
        plan: Plan.FREE,
        stripePriceId: null,
      });
      expect(mockMailQueueService.queueSubscriptionCancelled).toHaveBeenCalledWith(
        baseUser.email,
        baseUser.name,
      );
    });
  });

  describe('handle — customer.subscription.updated', () => {
    const makeSubscription = (overrides: Record<string, unknown>) => ({
      customer: 'cus_test',
      status: 'active',
      cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_gold' } }] },
      ...overrides,
    });

    it('returns early when cancel_at_period_end is true', async () => {
      const event = makeEvent(
        'customer.subscription.updated',
        makeSubscription({ cancel_at_period_end: true }),
      );
      await handler.handle(event);
      expect(mockUsersRepository.findByStripeCustomerId).not.toHaveBeenCalled();
    });

    it('returns early when subscription status is not active', async () => {
      const event = makeEvent(
        'customer.subscription.updated',
        makeSubscription({ status: 'past_due' }),
      );
      await handler.handle(event);
      expect(mockUsersRepository.findByStripeCustomerId).not.toHaveBeenCalled();
    });

    it('returns early when user not found', async () => {
      mockUsersRepository.findByStripeCustomerId.mockResolvedValue(null);
      const event = makeEvent(
        'customer.subscription.updated',
        makeSubscription({}),
      );
      await handler.handle(event);
      expect(mockUsersRepository.update).not.toHaveBeenCalled();
    });

    it('updates plan and stripePriceId on active subscription', async () => {
      mockUsersRepository.findByStripeCustomerId.mockResolvedValue({
        ...baseUser,
        plan: Plan.FREE,
      });
      mockUsersRepository.update.mockResolvedValue({});
      const event = makeEvent(
        'customer.subscription.updated',
        makeSubscription({
          items: { data: [{ price: { id: 'price_gold' } }] },
        }),
      );
      await handler.handle(event);
      expect(mockUsersRepository.update).toHaveBeenCalledWith('user_1', {
        plan: Plan.GOLD,
        stripePriceId: 'price_gold',
      });
    });

    it('sends downgrade email when PLATINUM→GOLD', async () => {
      mockUsersRepository.findByStripeCustomerId.mockResolvedValue({
        ...baseUser,
        plan: Plan.PLATINUM,
      });
      mockUsersRepository.update.mockResolvedValue({});
      const event = makeEvent(
        'customer.subscription.updated',
        makeSubscription({
          items: { data: [{ price: { id: 'price_gold' } }] },
        }),
      );
      await handler.handle(event);
      expect(mockMailQueueService.queueDowngradeNotification).toHaveBeenCalledWith(
        baseUser.email,
        baseUser.name,
        Plan.GOLD,
      );
    });
  });

  describe('handle — unknown event type', () => {
    it('does nothing for unknown event type', async () => {
      const event = makeEvent('payment_intent.created', { id: 'pi_1' });
      await handler.handle(event);
      expect(mockUsersRepository.findByStripeCustomerId).not.toHaveBeenCalled();
      expect(mockUsersRepository.update).not.toHaveBeenCalled();
      expect(mockMailQueueService.queueDowngradeNotification).not.toHaveBeenCalled();
      expect(mockMailQueueService.queueSubscriptionCancelled).not.toHaveBeenCalled();
    });
  });

  describe('idempotency', () => {
    it('registers the event id before processing', async () => {
      mockUsersRepository.findByStripeCustomerId.mockResolvedValue(null);
      const event = {
        id: 'evt_123',
        type: 'customer.subscription.deleted',
        data: { object: { customer: 'cus_1' } },
      } as unknown as Stripe.Event;

      await handler.handle(event);

      expect(mockStripeEventsRepository.register).toHaveBeenCalledWith(
        'evt_123',
        'customer.subscription.deleted',
      );
    });

    it('skips processing entirely on a duplicate delivery', async () => {
      mockStripeEventsRepository.register.mockResolvedValue(false);
      const event = {
        id: 'evt_dup',
        type: 'customer.subscription.deleted',
        data: { object: { customer: 'cus_1' } },
      } as unknown as Stripe.Event;

      await handler.handle(event);

      expect(
        mockUsersRepository.findByStripeCustomerId,
      ).not.toHaveBeenCalled();
      expect(mockUsersRepository.update).not.toHaveBeenCalled();
      expect(
        mockMailQueueService.queueSubscriptionCancelled,
      ).not.toHaveBeenCalled();
    });

    it('unregisters the event and rethrows when processing fails', async () => {
      mockUsersRepository.findByStripeCustomerId.mockRejectedValue(
        new Error('db down'),
      );
      const event = {
        id: 'evt_fail',
        type: 'customer.subscription.deleted',
        data: { object: { customer: 'cus_1' } },
      } as unknown as Stripe.Event;

      await expect(handler.handle(event)).rejects.toThrow('db down');
      expect(mockStripeEventsRepository.unregister).toHaveBeenCalledWith(
        'evt_fail',
      );
    });

    it('rethrows the original error even when unregister itself fails', async () => {
      mockUsersRepository.findByStripeCustomerId.mockRejectedValue(
        new Error('original failure'),
      );
      mockStripeEventsRepository.unregister.mockRejectedValue(
        new Error('unregister also failed'),
      );
      const event = {
        id: 'evt_double_fail',
        type: 'customer.subscription.deleted',
        data: { object: { customer: 'cus_1' } },
      } as unknown as Stripe.Event;

      await expect(handler.handle(event)).rejects.toThrow('original failure');
    });
  });
});
