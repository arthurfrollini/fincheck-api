import * as path from 'path';
import request from 'supertest';
import { parseBody } from '../helpers/body';
import { z } from 'zod';
import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import {
  createApp,
  fakeEmbedding,
  mockLlmService,
} from '../helpers/create-app';
import { loadMessageFixture } from '../helpers/llm';
import { cleanDatabase } from '../helpers/db-cleaner';
import { signUpAndGetTokens } from '../helpers/auth.helper';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { KnowledgeChunksRepository } from '../../src/modules/education/domain/repositories/knowledge-chunks.repository';

const cited = loadMessageFixture(
  path.resolve(__dirname, '../fixtures/llm/rag/cited.json'),
);

const QUESTION = 'quanto devo guardar por mês?';

describe('Education (e2e)', () => {
  let app: INestApplication<App>;
  let accessToken: string;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    // Leave no fake-embedding chunks behind: CI ingests the real corpus into
    // this same database right after the suite and runs the retrieval eval.
    await cleanDatabase(app);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    ({ accessToken } = await signUpAndGetTokens(app));
    // FREE has no AI access; these tests exercise the feature itself.
    await app.get(PrismaService).user.updateMany({ data: { plan: 'GOLD' } });
    mockLlmService.complete.mockReset().mockResolvedValue(cited);
    // Two chunks share the question's fake vector (similarity 1), so they
    // are the top two retrieved: document_index 0 and 1 in the fixture.
    await app.get(KnowledgeChunksRepository).replaceAll([
      {
        documentSha: 'e2e',
        chunkIndex: 0,
        page: 12,
        text: 'poupar todo mês antes de gastar',
        embedding: fakeEmbedding(QUESTION),
      },
      {
        documentSha: 'e2e',
        chunkIndex: 1,
        page: 40,
        text: 'reserva de 3 a 6 meses',
        embedding: fakeEmbedding(QUESTION),
      },
      {
        documentSha: 'e2e',
        chunkIndex: 2,
        page: 77,
        text: 'imposto de renda',
        embedding: fakeEmbedding('outro assunto'),
      },
    ]);
  });

  const ask = (question: unknown, token = accessToken) =>
    request(app.getHttpServer())
      .post('/education/questions')
      .set('Authorization', `Bearer ${token}`)
      .send({ question });

  it('answers from pgvector-retrieved chunks with page citations', async () => {
    const res = await ask(QUESTION);

    expect(res.status).toBe(200);
    const { citations } = parseBody(
      res,
      z.object({ citations: z.array(z.object({ page: z.number() })) }),
    );
    expect(citations.map((c) => c.page).sort()).toEqual([12, 40]);
    expect(res.body).toMatchObject({ model: 'claude-sonnet-5-5' });
    expect(res.body).not.toHaveProperty('result');
  });

  it('does not call the model for a question the material does not cover', async () => {
    const res = await ask('receita de bolo de cenoura');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ citations: [] });
    expect(mockLlmService.complete).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', ''],
    ['too long', 'a'.repeat(501)],
    ['not a string', 42],
  ])('returns 400 for a %s question', async (_label, question) => {
    expect((await ask(question)).status).toBe(400);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app.getHttpServer())
      .post('/education/questions')
      .send({ question: QUESTION });
    expect(res.status).toBe(401);
  });
});
