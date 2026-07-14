import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp, mockBillingService } from '../helpers/create-app';
import { cleanDatabase } from '../helpers/db-cleaner';
import { signUpAndGetTokens } from '../helpers/auth.helper';

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
});
