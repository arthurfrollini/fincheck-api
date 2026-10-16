import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import {
  createApp,
  fakeEmbedding,
  mockLlmService,
} from '../helpers/create-app';
import { cleanDatabase } from '../helpers/db-cleaner';
import { signUpAndGetTokens } from '../helpers/auth.helper';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { KnowledgeChunksRepository } from '../../src/modules/education/domain/repositories/knowledge-chunks.repository';

const QUESTION = 'quanto devo guardar por mês?';
const usage = {
  input_tokens: 100,
  output_tokens: 10,
  cache_read_input_tokens: null,
  cache_creation_input_tokens: null,
};

describe('AI quotas and daily budget (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    await prisma.aiUsage.deleteMany();
    ({ accessToken: token } = await signUpAndGetTokens(app));
    userId = (await prisma.user.findFirstOrThrow()).id;
    await app.get(KnowledgeChunksRepository).replaceAll([
      {
        documentSha: 'e2e',
        chunkIndex: 0,
        page: 1,
        text: 'guarde todo mês',
        embedding: fakeEmbedding(QUESTION),
      },
    ]);
    mockLlmService.complete.mockReset().mockResolvedValue({
      role: 'assistant',
      stop_reason: 'end_turn',
      usage,
      content: [{ type: 'text', text: 'Guarde todo mês.', citations: null }],
    });
  });

  const setPlan = (plan: string) =>
    prisma.user.update({
      where: { id: userId },
      data: { plan: plan as never },
    });
  const seedUsage = (n: number, feature: string, costUsd = 0.001) =>
    prisma.aiUsage.createMany({
      data: Array.from({ length: n }, () => ({
        userId,
        feature,
        model: 'claude-sonnet-5-5',
        inputTokens: 1,
        outputTokens: 1,
        costUsd,
      })),
    });
  const askRag = () =>
    request(app.getHttpServer())
      .post('/education/questions')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: QUESTION });
  const askAgent = (key?: string) => {
    const r = request(app.getHttpServer())
      .post('/assistant/questions')
      .set('Authorization', `Bearer ${token}`);
    if (key) r.set('Idempotency-Key', key);
    return r.send({ question: 'quanto gastei?' });
  };

  it('FREE users get 403 on both AI endpoints, and nothing reaches the model', async () => {
    const rag = await askRag();
    const agent = await askAgent();

    expect(rag.status).toBe(403);
    expect(agent.status).toBe(403);
    expect(rag.body.message).toBe(
      'AI features require a GOLD or PLATINUM plan.',
    );
    expect(mockLlmService.complete).not.toHaveBeenCalled();
    expect(await prisma.agentRun.count()).toBe(0);
  });

  it('GOLD users can ask until the 20th RAG question of the day, then get 403', async () => {
    await setPlan('GOLD');
    await seedUsage(19, 'rag');

    expect((await askRag()).status).toBe(200);
    // e2e mocks LlmService, so the real per-call usage row isn't written;
    // add the row that the 20th question would have recorded.
    await seedUsage(1, 'rag');
    const refused = await askRag();
    expect(refused.status).toBe(403);
    expect(refused.body.message).toBe(
      'Your plan includes 20 education questions per day.',
    );
  });

  it('a repeated Idempotency-Key at the agent limit returns the existing run, not a 403', async () => {
    await setPlan('GOLD');
    const first = await askAgent('same-key');
    expect(first.status).toBe(202);
    await prisma.agentRun.createMany({
      data: Array.from({ length: 19 }, () => ({
        userId,
        question: 'q',
        status: 'COMPLETED' as const,
      })),
    });

    const repeat = await askAgent('same-key');
    expect(repeat.status).toBe(200);
    expect(repeat.body.runId).toBe(first.body.runId);
    expect((await askAgent('new-key')).status).toBe(403);
  });

  it('everyone gets 503 once the global daily spend ceiling is reached', async () => {
    await setPlan('PLATINUM');
    await seedUsage(1, 'agent', 1.5);

    const rag = await askRag();
    expect(rag.status).toBe(503);
    expect((await askAgent()).status).toBe(503);
  });
});
