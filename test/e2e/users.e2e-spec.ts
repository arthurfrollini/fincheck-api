import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp, mockMailService } from '../helpers/create-app';
import { cleanDatabase } from '../helpers/db-cleaner';
import { signUpAndGetTokens, uniqueEmail } from '../helpers/auth.helper';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { cleanMailQueue, waitForLatestMailJob } from '../helpers/queue-helper';
import { EMAIL_CHANGE_CONFIRMATION_JOB_NAME } from '../../src/shared/mail/mail-job.types';

describe('Users (e2e)', () => {
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

  describe('GET /users/me', () => {
    it('returns current user', async () => {
      const res = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('email');
      expect(res.body).toHaveProperty('name');
    });

    it('returns 401 without token', async () => {
      const res = await request(app.getHttpServer()).get('/users/me');
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /users/me', () => {
    it('updates user name and returns 200', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'New Name' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('New Name');
    });
  });

  describe('GET /users/me/avatar-upload-url', () => {
    it('returns uploadUrl and avatarUrl', async () => {
      const res = await request(app.getHttpServer())
        .get('/users/me/avatar-upload-url')
        .query({ ext: 'jpg' })
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('uploadUrl');
      expect(res.body).toHaveProperty('avatarUrl');
    });
  });

  describe('PATCH /users/me/email', () => {
    it('sends email change request and returns 204', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me/email')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ newEmail: uniqueEmail('new') });

      expect(res.status).toBe(204);

      await waitForLatestMailJob(app, EMAIL_CHANGE_CONFIRMATION_JOB_NAME);

      expect(mockMailService.sendEmailChangeConfirmation).toHaveBeenCalledTimes(
        1,
      );
    });

    it('returns 409 if new email already in use', async () => {
      const takenEmail = uniqueEmail('taken');
      await signUpAndGetTokens(app, takenEmail);

      const res = await request(app.getHttpServer())
        .patch('/users/me/email')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ newEmail: takenEmail });

      expect(res.status).toBe(409);
    });
  });

  describe('GET /users/confirm-email', () => {
    it('confirms email change and returns 204', async () => {
      const newEmail = uniqueEmail('confirmed');
      const patchRes = await request(app.getHttpServer())
        .patch('/users/me/email')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ newEmail: newEmail });

      expect(patchRes.status).toBe(204);

      const prisma = app.get(PrismaService);
      const user = await prisma.user.findFirst({
        where: { pendingEmail: newEmail },
      });

      expect(user).not.toBeNull();

      const res = await request(app.getHttpServer())
        .get('/users/confirm-email')
        .query({ token: user!.emailToken });

      expect(res.status).toBe(204);
    });
  });
});
