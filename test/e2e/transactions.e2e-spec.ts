import request from 'supertest';
import { categoryList, idList, parseBody, withId } from '../helpers/body';
import { z } from 'zod';
import { loadMessageFixture } from '../helpers/llm';
import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import * as path from 'path';
import { createApp, mockLlmService } from '../helpers/create-app';
import { cleanDatabase } from '../helpers/db-cleaner';
import { signUpAndGetTokens } from '../helpers/auth.helper';

describe('Transactions (e2e)', () => {
  let app: INestApplication<App>;
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
      .send({
        name: 'Nubank',
        initialBalance: 0,
        color: '#000',
        type: 'CHECKING',
      });
    bankAccountId = parseBody(baRes, withId).id;

    const catRes = await request(app.getHttpServer())
      .get('/categories')
      .set('Authorization', `Bearer ${accessToken}`);
    categoryId = parseBody(catRes, idList)[0].id;
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
      expect(res.body).toMatchObject({ name: 'Groceries' });
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

  describe('POST /transactions without categoryId (auto-categorization)', () => {
    const okFixture = loadMessageFixture(
      path.resolve(__dirname, '../fixtures/llm/categorization/ok.json'),
    );
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    let expenseCategoryId: string;

    beforeEach(async () => {
      mockLlmService.parse.mockReset();
      const catRes = await request(app.getHttpServer())
        .get('/categories')
        .set('Authorization', `Bearer ${accessToken}`);
      const expense = parseBody(catRes, categoryList).find(
        (c) => c.type === 'EXPENSE',
      );
      if (!expense) throw new Error('no EXPENSE category');
      expenseCategoryId = expense.id;
      mockLlmService.parse.mockResolvedValue({
        ...okFixture,
        parsed_output: { categoryId: expenseCategoryId, confidence: 0.92 },
      });
    });

    const findCategoryId = async (id: string) => {
      const res = await request(app.getHttpServer())
        .get('/transactions')
        .query({ month: 6, year: 2026 })
        .set('Authorization', `Bearer ${accessToken}`);
      const { data } = parseBody(
        res,
        z.object({
          data: z.array(
            z.object({ id: z.string(), categoryId: z.string().nullable() }),
          ),
        }),
      );
      return data.find((t) => t.id === id)?.categoryId ?? null;
    };

    it('returns 201 with categoryId null, then the worker fills it in', async () => {
      const res = await createTransaction({ categoryId: undefined });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ categoryId: null });

      let categoryIdAfter: string | null = null;
      for (let i = 0; i < 50 && !categoryIdAfter; i++) {
        await sleep(100);
        categoryIdAfter = await findCategoryId(parseBody(res, withId).id);
      }
      expect(categoryIdAfter).toBe(expenseCategoryId);
      expect(mockLlmService.parse).toHaveBeenCalledTimes(1);
    });

    it('does not call the model when categoryId is sent', async () => {
      const res = await createTransaction();

      expect(res.status).toBe(201);
      await sleep(500);
      expect(mockLlmService.parse).not.toHaveBeenCalled();
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
      expect(res.body).toMatchObject({ meta: { total: 1 } });
    });

    it('returns empty data for different month', async () => {
      await createTransaction();
      const res = await request(app.getHttpServer())
        .get('/transactions')
        .query({ month: 1, year: 2026 })
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ meta: { total: 0 } });
    });
  });

  describe('PUT /transactions/:transactionId', () => {
    it('updates transaction and returns 200', async () => {
      const created = await createTransaction();
      const { id } = parseBody(created, withId);

      const res = await request(app.getHttpServer())
        .put(`/transactions/${id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(txPayload({ name: 'Updated', value: 200 }));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'Updated' });
    });

    it('returns 404 when transaction belongs to another user', async () => {
      const created = await createTransaction();
      const { id } = parseBody(created, withId);
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
      const { id } = parseBody(created, withId);

      const res = await request(app.getHttpServer())
        .delete(`/transactions/${id}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(204);
    });
  });
});
