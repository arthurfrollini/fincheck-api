import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp, mockMailService } from '../helpers/create-app';
import { cleanDatabase } from '../helpers/db-cleaner';
import { signUpAndGetTokens, uniqueEmail } from '../helpers/auth.helper';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { RefreshTokensRepository } from '../../src/modules/auth/domain/repositories/refresh-tokens.repository';
import { cleanMailQueue, waitForLatestMailJob } from '../helpers/queue-helper';
import { WELCOME_JOB_NAME } from '../../src/shared/mail/mail-job.types';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await cleanDatabase(app);
    await cleanMailQueue(app);
  });

  describe('POST /auth/signup', () => {
    it('creates user and returns 201 with tokens', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ name: 'Arthur', email: uniqueEmail(), password: 'Test@1234' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
    });

    it('queues and delivers the welcome email asynchronously', async () => {
      // Reset the mock so the assertion counts only this test's welcome job,
      // not any welcome job the worker processed asynchronously from an
      // earlier signup test in this suite.
      mockMailService.sendWelcome.mockClear();

      const res = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ name: 'Arthur', email: uniqueEmail(), password: 'Test@1234' });

      expect(res.status).toBe(201);

      await waitForLatestMailJob(app, WELCOME_JOB_NAME);

      expect(mockMailService.sendWelcome).toHaveBeenCalledTimes(1);
    });

    it('retries a failed welcome email and succeeds on the second attempt', async () => {
      // Proves the retry options are actually wired into queue.add — if
      // someone drops attempts/backoff from MailQueueService, this fails.
      // First delivery attempt rejects (Resend "down"), BullMQ re-schedules
      // via the email-retry backoff (~1s for attempt 1), second succeeds.
      mockMailService.sendWelcome.mockClear();
      mockMailService.sendWelcome.mockRejectedValueOnce(
        new Error('Resend unavailable'),
      );

      const res = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ name: 'Arthur', email: uniqueEmail(), password: 'Test@1234' });

      expect(res.status).toBe(201);

      await waitForLatestMailJob(app, WELCOME_JOB_NAME);

      expect(mockMailService.sendWelcome).toHaveBeenCalledTimes(2);
    });

    it('returns 409 on duplicate email', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ name: 'Arthur', email, password: 'Test@1234' });

      const res = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ name: 'Arthur', email, password: 'Test@1234' });

      expect(res.status).toBe(409);
    });

    it('returns 400 on invalid body', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ name: 'Arthur' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /auth/signin', () => {
    it('returns tokens on valid credentials', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ name: 'Arthur', email, password: 'Test@1234' });

      const res = await request(app.getHttpServer())
        .post('/auth/signin')
        .send({ email, password: 'Test@1234' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
    });

    it('returns 401 on wrong password', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ name: 'Arthur', email, password: 'Test@1234' });

      const res = await request(app.getHttpServer())
        .post('/auth/signin')
        .send({ email, password: 'WrongPassword' });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('returns new token pair with valid refresh token', async () => {
      const { refreshToken } = await signUpAndGetTokens(app);

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
    });

    it('returns 401 with invalid refresh token', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'not-a-real-token' });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/signout', () => {
    it('returns 204 and invalidates the refresh token', async () => {
      const { refreshToken } = await signUpAndGetTokens(app);

      const res = await request(app.getHttpServer())
        .post('/auth/signout')
        .send({ refreshToken });

      expect(res.status).toBe(204);

      const refreshRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken });
      expect(refreshRes.status).toBe(401);
    });
  });

  describe('RefreshTokensPrismaRepository.deleteExpired', () => {
    it('deletes only expired refresh tokens from the database', async () => {
      const email = uniqueEmail();
      await signUpAndGetTokens(app, email);

      const prisma = app.get(PrismaService);
      const repository = app.get(RefreshTokensRepository);

      const user = await prisma.user.findFirstOrThrow({ where: { email } });

      const expired = await prisma.refreshToken.create({
        data: {
          userId: user.id,
          token: 'expired-token',
          expiresAt: new Date(Date.now() - 60_000),
        },
      });

      const valid = await prisma.refreshToken.create({
        data: {
          userId: user.id,
          token: 'valid-token',
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      await repository.deleteExpired();

      const expiredFound = await prisma.refreshToken.findUnique({
        where: { id: expired.id },
      });
      const validFound = await prisma.refreshToken.findUnique({
        where: { id: valid.id },
      });

      expect(expiredFound).toBeNull();
      expect(validFound).not.toBeNull();
    });
  });
});
