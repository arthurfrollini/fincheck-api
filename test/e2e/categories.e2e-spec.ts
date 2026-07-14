import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp } from '../helpers/create-app';
import { cleanDatabase } from '../helpers/db-cleaner';
import { signUpAndGetTokens } from '../helpers/auth.helper';

describe('Categories (e2e)', () => {
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
    ({ accessToken } = await signUpAndGetTokens(app));
  });

  describe('GET /categories', () => {
    it('returns seeded categories for authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .get('/categories')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('returns 401 without token', async () => {
      const res = await request(app.getHttpServer()).get('/categories');
      expect(res.status).toBe(401);
    });

    it('does not return categories of another user', async () => {
      const { accessToken: otherToken } = await signUpAndGetTokens(app);
      const res = await request(app.getHttpServer())
        .get('/categories')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(200);
      const myRes = await request(app.getHttpServer())
        .get('/categories')
        .set('Authorization', `Bearer ${accessToken}`);

      const myIds = myRes.body.map((c: { id: string }) => c.id);
      const otherIds = res.body.map((c: { id: string }) => c.id);
      expect(myIds).not.toEqual(expect.arrayContaining(otherIds));
    });
  });
});
