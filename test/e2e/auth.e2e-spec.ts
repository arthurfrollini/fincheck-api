import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp } from '../helpers/create-app';
import { cleanDatabase } from '../helpers/db-cleaner';
import { signUpAndGetTokens, uniqueEmail } from '../helpers/auth.helper';

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
});
