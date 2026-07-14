import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp } from '../helpers/create-app';
import { cleanDatabase } from '../helpers/db-cleaner';
import { signUpAndGetTokens } from '../helpers/auth.helper';

describe('Transactions (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let bankAccountId: string;
  let categoryId: string;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    ({ accessToken } = await signUpAndGetTokens(app));

    const baRes = await request(app.getHttpServer())
      .post('/bank-accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Nubank', initialBalance: 0, color: '#000', type: 'CHECKING' });
    bankAccountId = baRes.body.id;

    const catRes = await request(app.getHttpServer())
      .get('/categories')
      .set('Authorization', `Bearer ${accessToken}`);
    categoryId = catRes.body[0].id;
  });

  const txPayload = (overrides = {}) => ({
    name: 'Groceries',
    value: 100,
    date: new Date(2026, 5, 15).toISOString(),
    type: 'EXPENSE',
    bankAccountId,
    categoryId,
    ...overrides,
  });

  const createTransaction = (overrides = {}) =>
    request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(txPayload(overrides));

  describe('POST /transactions', () => {
    it('creates transaction and returns 201', async () => {
      const res = await createTransaction();
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('Groceries');
    });

    it('returns 401 without token', async () => {
      const res = await request(app.getHttpServer())
        .post('/transactions')
        .send(txPayload());
      expect(res.status).toBe(401);
    });

    it('returns 404 when bankAccount belongs to another user', async () => {
      const { accessToken: otherToken } = await signUpAndGetTokens(app);
      const res = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${otherToken}`)
        .send(txPayload());
      expect(res.status).toBe(404);
    });
  });

  describe('GET /transactions', () => {
    it('returns paginated transactions with meta', async () => {
      await createTransaction();
      const res = await request(app.getHttpServer())
        .get('/transactions')
        .query({ month: 6, year: 2026 })
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
      expect(res.body.meta.total).toBe(1);
    });

    it('returns empty data for different month', async () => {
      await createTransaction();
      const res = await request(app.getHttpServer())
        .get('/transactions')
        .query({ month: 1, year: 2026 })
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(0);
    });
  });

  describe('PUT /transactions/:transactionId', () => {
    it('updates transaction and returns 200', async () => {
      const created = await createTransaction();
      const id = created.body.id;

      const res = await request(app.getHttpServer())
        .put(`/transactions/${id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(txPayload({ name: 'Updated', value: 200 }));

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated');
    });

    it('returns 404 when transaction belongs to another user', async () => {
      const created = await createTransaction();
      const id = created.body.id;
      const { accessToken: otherToken } = await signUpAndGetTokens(app);

      const res = await request(app.getHttpServer())
        .put(`/transactions/${id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send(txPayload({ name: 'Hack' }));

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /transactions/:transactionId', () => {
    it('deletes transaction and returns 204', async () => {
      const created = await createTransaction();
      const id = created.body.id;

      const res = await request(app.getHttpServer())
        .delete(`/transactions/${id}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(204);
    });
  });
});
