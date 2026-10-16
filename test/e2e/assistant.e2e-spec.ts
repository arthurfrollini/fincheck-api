import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp, mockLlmService } from '../helpers/create-app';
import { cleanDatabase } from '../helpers/db-cleaner';
import { signUpAndGetTokens } from '../helpers/auth.helper';
import { PrismaService } from '../../src/shared/database/prisma.service';

const usage = {
  input_tokens: 500,
  output_tokens: 80,
  cache_read_input_tokens: null,
  cache_creation_input_tokens: null,
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Assistant (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let toolResults: unknown[];

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    ({ accessToken: token } = await signUpAndGetTokens(app));
    // FREE has no AI access; these tests exercise the feature itself.
    await app.get(PrismaService).user.updateMany({ data: { plan: 'GOLD' } });
    const server = app.getHttpServer();
    const bank = await request(server)
      .post('/bank-accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Nubank',
        initialBalance: 0,
        color: '#000',
        type: 'CHECKING',
      });
    const categories = await request(server)
      .get('/categories')
      .set('Authorization', `Bearer ${token}`);
    const food = categories.body.find(
      (c: { name: string }) => c.name === 'Alimentação',
    );
    for (const [name, value] of [
      ['99 Food', 40.5],
      ['Restaurante', 59.5],
    ] as const) {
      await request(server)
        .post('/transactions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name,
          value,
          type: 'EXPENSE',
          date: '2026-09-10',
          bankAccountId: bank.body.id,
          categoryId: food.id,
        });
    }

    // Scripted model: one compute_totals round, then an answer. The tool runs
    // for real against this user's rows; its result is captured.
    toolResults = [];
    mockLlmService.complete
      .mockReset()
      .mockImplementation((_feature, params) => {
        const last = params.messages[params.messages.length - 1];
        if (last.role === 'user' && Array.isArray(last.content)) {
          toolResults.push(...last.content);
          return Promise.resolve({
            role: 'assistant',
            stop_reason: 'end_turn',
            usage,
            content: [
              { type: 'text', text: 'Você gastou R$ 100,00.', citations: null },
            ],
          });
        }
        return Promise.resolve({
          role: 'assistant',
          stop_reason: 'tool_use',
          usage,
          content: [
            {
              type: 'tool_use',
              id: 'tu-1',
              name: 'compute_totals',
              input: {
                from: '2026-09-01',
                to: '2026-09-30',
                type: 'EXPENSE',
                groupBy: 'none',
              },
            },
          ],
        });
      });
  });

  const ask = (question: string, key?: string, auth = token) => {
    const req = request(app.getHttpServer())
      .post('/assistant/questions')
      .set('Authorization', `Bearer ${auth}`);
    if (key) req.set('Idempotency-Key', key);
    return req.send({ question });
  };
  const poll = async (runId: string) => {
    for (let i = 0; i < 50; i++) {
      const res = await request(app.getHttpServer())
        .get(`/assistant/runs/${runId}`)
        .set('Authorization', `Bearer ${token}`);
      if (!['QUEUED', 'RUNNING'].includes(res.body.status)) return res.body;
      await sleep(100);
    }
    throw new Error('run did not finish');
  };

  it("accepts a question, runs the tools on this user's data and completes", async () => {
    const res = await ask('quanto gastei em setembro?');

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ runId: expect.any(String), status: 'QUEUED' });
    const run = await poll(res.body.runId);
    expect(run).toEqual(
      expect.objectContaining({
        status: 'COMPLETED',
        answer: 'Você gastou R$ 100,00.',
        steps: 2,
      }),
    );
    expect(
      JSON.parse((toolResults[0] as { content: string }).content).grandTotal,
    ).toBe(100);
  });

  it('returns the same run for a repeated Idempotency-Key and runs it once', async () => {
    const first = await ask('quanto gastei?', 'key-123');
    const second = await ask('quanto gastei?', 'key-123');

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.body.runId).toBe(first.body.runId);
    await poll(first.body.runId);
    await sleep(300);
    expect(mockLlmService.complete).toHaveBeenCalledTimes(2);
  });

  it('does not show a run to another user', async () => {
    const res = await ask('quanto gastei?');
    await poll(res.body.runId);
    const { accessToken: other } = await signUpAndGetTokens(app);

    const peek = await request(app.getHttpServer())
      .get(`/assistant/runs/${res.body.runId}`)
      .set('Authorization', `Bearer ${other}`);
    expect(peek.status).toBe(404);
  });

  it("only reads the asking user's transactions", async () => {
    const { accessToken: other } = await signUpAndGetTokens(app);
    await app.get(PrismaService).user.updateMany({ data: { plan: 'GOLD' } });
    const res = await ask('quanto gastei em setembro?', undefined, other);
    token = other;
    await poll(res.body.runId);

    expect(
      JSON.parse((toolResults[0] as { content: string }).content).grandTotal,
    ).toBe(0);
  });

  it.each([
    ['empty', ''],
    ['too long', 'a'.repeat(501)],
  ])('returns 400 for a %s question', async (_l, q) => {
    expect((await ask(q)).status).toBe(400);
  });
});
