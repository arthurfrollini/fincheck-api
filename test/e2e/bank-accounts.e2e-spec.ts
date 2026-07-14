import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp } from '../helpers/create-app';
import { cleanDatabase } from '../helpers/db-cleaner';
import { signUpAndGetTokens } from '../helpers/auth.helper';

describe('BankAccounts (e2e)', () => {
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

  const createBankAccount = (token = accessToken) =>
    request(app.getHttpServer())
      .post('/bank-accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Nubank', initialBalance: 1000, color: '#000000', type: 'CHECKING' });

  describe('POST /bank-accounts', () => {
    it('creates bank account and returns 201', async () => {
      const res = await createBankAccount();
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('Nubank');
    });

    it('returns 401 without token', async () => {
      const res = await request(app.getHttpServer())
        .post('/bank-accounts')
        .send({ name: 'Nubank', initialBalance: 0, color: '#000', type: 'CHECKING' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /bank-accounts', () => {
    it('returns list of bank accounts for authenticated user', async () => {
      await createBankAccount();
      const res = await request(app.getHttpServer())
        .get('/bank-accounts')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
    });

    it('does not return bank accounts of another user', async () => {
      await createBankAccount();
      const { accessToken: otherToken } = await signUpAndGetTokens(app);

      const res = await request(app.getHttpServer())
        .get('/bank-accounts')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });
  });

  describe('PUT /bank-accounts/:bankAccountId', () => {
    it('updates bank account and returns 200', async () => {
      const created = await createBankAccount();
      const id = created.body.id;

      const res = await request(app.getHttpServer())
        .put(`/bank-accounts/${id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Updated', initialBalance: 500, color: '#ffffff', type: 'INVESTMENT' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated');
    });

    it('returns 404 when bank account belongs to another user', async () => {
      const created = await createBankAccount();
      const id = created.body.id;
      const { accessToken: otherToken } = await signUpAndGetTokens(app);

      const res = await request(app.getHttpServer())
        .put(`/bank-accounts/${id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ name: 'Hack', initialBalance: 0, color: '#000', type: 'CHECKING' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /bank-accounts/:bankAccountId', () => {
    it('deletes bank account and returns 204', async () => {
      const created = await createBankAccount();
      const id = created.body.id;

      const res = await request(app.getHttpServer())
        .delete(`/bank-accounts/${id}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(204);
    });

    it('returns 404 when bank account belongs to another user', async () => {
      const created = await createBankAccount();
      const id = created.body.id;
      const { accessToken: otherToken } = await signUpAndGetTokens(app);

      const res = await request(app.getHttpServer())
        .delete(`/bank-accounts/${id}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(404);
    });
  });
});
