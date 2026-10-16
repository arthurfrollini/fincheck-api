// Answer-quality eval: runs the 20 judged questions through the production
// RAG path (local embeddings, pgvector, Sonnet 5.5 with citations) and has
// Opus 5.5 grade each answer against its key points. Calls the Claude API,
// so it runs only in the scheduled workflow or by hand. Needs DATABASE_URL
// with the corpus ingested and a real ANTHROPIC_API_KEY.
//
//   npm run eval:rag-answers [-- --update-baseline]
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { type PinoLogger } from 'nestjs-pino';
import { createAnthropicClient } from '../../src/shared/llm/anthropic-client';
import { LlmMetrics } from '../../src/shared/llm/llm.metrics';
import { LlmService } from '../../src/shared/llm/llm.service';
import { AnswerQuestionService } from '../../src/modules/education/application/answer-question.service';
import { KnowledgeChunksPrismaRepository } from '../../src/modules/education/infra/database/knowledge-chunks.prisma.repository';
import { TransformersEmbeddingProvider } from '../../src/modules/education/infra/embeddings/transformers-embedding.provider';
import { type PrismaService } from '../../src/shared/database/prisma.service';
import { assertRealKey } from '../categorization/runner';
import { type Baseline } from '../lib/baseline';
import {
  judgeAnswer,
  loadAnswerSet,
  runAnswerEval,
  summarizeAnswerRun,
} from './judge';

// override: Prisma's client already loaded .env on import; DOTENV_PATH must win.
dotenv.config({ path: process.env.DOTENV_PATH ?? '.env', override: true });

const BASELINE_FILE = path.resolve(__dirname, '../baselines/rag-answers.json');

async function main(): Promise<number> {
  const key = process.env.ANTHROPIC_API_KEY;
  assertRealKey(key);

  const prisma = new PrismaClient();
  try {
    const logger = {
      info: () => undefined,
      warn: (obj: object, msg: string) => console.warn(msg, obj),
    } as unknown as PinoLogger;
    const llm = new LlmService(
      createAnthropicClient(key),
      new LlmMetrics(),
      logger,
    );
    const rag = new AnswerQuestionService(
      new TransformersEmbeddingProvider(),
      new KnowledgeChunksPrismaRepository(prisma as unknown as PrismaService),
      llm,
    );

    const results = await runAnswerEval({
      cases: loadAnswerSet(),
      answer: (q) => rag.answer(q),
      judge: (input) => judgeAnswer(llm, input),
    });

    const baseline = fs.existsSync(BASELINE_FILE)
      ? (JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) as Baseline)
      : undefined;
    const updating = process.argv.includes('--update-baseline');
    const summary = summarizeAnswerRun(results, baseline, updating);

    console.log(
      [
        `## RAG answer eval (judge: claude-opus-5-5)`,
        '',
        `**Passed:** ${summary.correct}/${summary.total} · **Errors:** ${summary.errors}`,
        summary.gate
          ? `**Gate:** ${summary.gate.status}: ${summary.gate.message}`
          : '',
        '',
        '| Case | Passed | Outcome | Grounded | Key points | Cites |',
        '|---|---|---|---|---|---|',
        ...results.map(
          (r) =>
            `| ${r.id} | ${r.passed ? 'yes' : 'no'} | ${r.outcome} | ${r.verdict?.grounded ?? '-'} | ${r.verdict ? r.verdict.coversKeyPoints.toFixed(2) : '-'} | ${r.verdict?.citesSources ?? '-'} |`,
        ),
      ].join('\n'),
    );

    if (updating && summary.newBaseline) {
      fs.writeFileSync(
        BASELINE_FILE,
        `${JSON.stringify(summary.newBaseline, null, 2)}\n`,
      );
    } else if (updating) {
      console.error(
        `Not updating the baseline: ${summary.errors} cases errored.`,
      );
    }
    return summary.exitCode;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
