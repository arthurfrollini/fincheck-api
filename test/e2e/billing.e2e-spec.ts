import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import Stripe from 'stripe';
import {
  createApp,
  mockBillingService,
  mockMailService,
} from '../helpers/create-app';
import { cleanDatabase } from '../helpers/db-cleaner';
import { signUpAndGetTokens } from '../helpers/auth.helper';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { cleanMailQueue, waitForLatestMailJob } from '../helpers/queue-helper';
import { SUBSCRIPTION_CANCELLED_JOB_NAME } from '../../src/shared/mail/mail-job.types';

describe('Billing (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    await cleanMailQueue(app);
    jest.clearAllMocks();
    ({ accessToken } = await signUpAndGetTokens(app));
  });

  describe('POST /billing/setup', () => {
    it('returns clientSecret and 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/billing/setup')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('clientSecret', 'seti_fake_secret');
    });

    it('returns 401 without token', async () => {
      const res = await request(app.getHttpServer()).post('/billing/setup');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /billing/subscribe', () => {
    it('calls createSubscription with planId and returns 204', async () => {
      const res = await request(app.getHttpServer())
        .post('/billing/subscribe')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ planId: 'GOLD' });

      expect(res.status).toBe(204);
      expect(mockBillingService.createSubscription).toHaveBeenCalledWith(
        expect.any(String),
        'GOLD',
      );
    });

    it('returns 400 on invalid planId', async () => {
      const res = await request(app.getHttpServer())
        .post('/billing/subscribe')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ planId: 'INVALID' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /billing/change-plan', () => {
    it('calls changePlan and returns 204', async () => {
      const res = await request(app.getHttpServer())
        .post('/billing/change-plan')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ planId: 'PLATINUM' });

      expect(res.status).toBe(204);
      expect(mockBillingService.changePlan).toHaveBeenCalledWith(
        expect.any(String),
        'PLATINUM',
      );
    });
  });

  describe('POST /billing/cancel', () => {
    it('calls cancelSubscription and returns 204', async () => {
      const res = await request(app.getHttpServer())
        .post('/billing/cancel')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(204);
      expect(mockBillingService.cancelSubscription).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /billing/webhook', () => {
    const stripe = new Stripe('sk_test_fake');
    const secret = 'whsec_fake'; // matches .env.test STRIPE_WEBHOOK_SECRET

    function signedPayload(event: Record<string, unknown>) {
      const payload = JSON.stringify(event);
      const header = stripe.webhooks.generateTestHeaderString({
        payload,
        secret,
      });
      return { payload, header };
    }

    it('returns 401 without stripe-signature header', async () => {
      const res = await request(app.getHttpServer())
        .post('/billing/webhook')
        .send({ type: 'test' });

      expect(res.status).toBe(401);
    });

    it('returns 401 with an invalid signature', async () => {
      const res = await request(app.getHttpServer())
        .post('/billing/webhook')
        .set('stripe-signature', 'not-a-real-signature')
        .send({ type: 'test' });

      expect(res.status).toBe(401);
    });

    it('processes a subscription-deleted event for real: resets plan and queues the email', async () => {
      // Give the signed-up user a Stripe customer id + a paid plan so the
      // cancellation event has something to act on.
      const prisma = app.get(PrismaService);
      const user = await prisma.user.findFirstOrThrow();
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: 'cus_e2e_test', plan: 'GOLD' },
      });
      mockMailService.sendSubscriptionCancelled.mockClear();

      const event = {
        id: 'evt_e2e_deleted_1',
        object: 'event',
        type: 'customer.subscription.deleted',
        data: { object: { customer: 'cus_e2e_test' } },
      };
      const { payload, header } = signedPayload(event);

      const res = await request(app.getHttpServer())
        .post('/billing/webhook')
        .set('stripe-signature', header)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(res.status).toBe(200);

      const updated = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(updated.plan).toBe('FREE');
      expect(updated.stripePriceId).toBeNull();

      await waitForLatestMailJob(app, SUBSCRIPTION_CANCELLED_JOB_NAME);
      expect(mockMailService.sendSubscriptionCancelled).toHaveBeenCalledTimes(
        1,
      );

      const dedupRow = await prisma.processedStripeEvent.findUnique({
        where: { eventId: 'evt_e2e_deleted_1' },
      });
      expect(dedupRow).not.toBeNull();
    });

    it('deduplicates a duplicate delivery: second POST is a no-op', async () => {
      const prisma = app.get(PrismaService);
      const user = await prisma.user.findFirstOrThrow();
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: 'cus_e2e_dup', plan: 'GOLD' },
      });
      mockMailService.sendSubscriptionCancelled.mockClear();

      const event = {
        id: 'evt_e2e_duplicate',
        object: 'event',
        type: 'customer.subscription.deleted',
        data: { object: { customer: 'cus_e2e_dup' } },
      };
      const { payload, header } = signedPayload(event);

      const first = await request(app.getHttpServer())
        .post('/billing/webhook')
        .set('stripe-signature', header)
        .set('Content-Type', 'application/json')
        .send(payload);
      expect(first.status).toBe(200);

      await waitForLatestMailJob(app, SUBSCRIPTION_CANCELLED_JOB_NAME);

      // Same exact signed payload again — Stripe redelivery.
      const second = await request(app.getHttpServer())
        .post('/billing/webhook')
        .set('stripe-signature', header)
        .set('Content-Type', 'application/json')
        .send(payload);
      expect(second.status).toBe(200);

      // Give the worker a beat: if a second job HAD been enqueued, it would
      // process within this window and break the call-count assertion.
      await new Promise((r) => setTimeout(r, 1500));

      expect(mockMailService.sendSubscriptionCancelled).toHaveBeenCalledTimes(
        1,
      );
      const rows = await prisma.processedStripeEvent.findMany({
        where: { eventId: 'evt_e2e_duplicate' },
      });
      expect(rows).toHaveLength(1);
    });
  });
});
