// Agent eval: seeds a fixed user (40 transactions, Aug-Sep 2026), asks the
// 10 questions through the production agent loop with real tools over
// Postgres, checks the expected numbers, and has Opus 5.5 confirm every
// number came from the tool results. Calls the Claude API: scheduled
// workflow or by hand. Needs DATABASE_URL (migrated) and a real key.
//
//   npm run eval:agent [-- --update-baseline]
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { type PinoLogger } from 'nestjs-pino';
import { createAnthropicClient } from '../../src/shared/llm/anthropic-client';
import { LlmMetrics } from '../../src/shared/llm/llm.metrics';
import { LlmService } from '../../src/shared/llm/llm.service';
import { type PrismaService } from '../../src/shared/database/prisma.service';
import { buildToolHandlers } from '../../src/modules/assistant/application/agent-tools';
import { runAgentLoop } from '../../src/modules/assistant/application/run-agent.service';
import { TransactionsPrismaRepository } from '../../src/modules/transactions/infra/database/transactions.prisma.repository';
import { CategoriesPrismaRepository } from '../../src/modules/categories/infra/database/categories.prisma.repository';
import { assertRealKey } from '../categorization/runner';
import { type Baseline } from '../lib/baseline';
import { summarizeAnswerRun } from '../rag/judge';
import { loadAgentCases } from './cases';
import { judgeGrounding } from './grade';
import { runAgentEval } from './runner';
import { EVAL_NOW, seedEvalUser } from './seed';

// Prisma's client loads .env on import, so an explicit DOTENV_PATH must
// override it; without one, values exported in the shell keep precedence.
dotenv.config({
  path: process.env.DOTENV_PATH ?? '.env',
  override: Boolean(process.env.DOTENV_PATH),
});

const BASELINE_FILE = path.resolve(__dirname, '../baselines/agent.json');

async function main(): Promise<number> {
  const key = process.env.ANTHROPIC_API_KEY;
  assertRealKey(key);

  const prisma = new PrismaClient();
  try {
    const userId = await seedEvalUser(prisma);
    const db = prisma as unknown as PrismaService;
    const handlers = buildToolHandlers(userId, {
      transactions: new TransactionsPrismaRepository(db),
      categories: new CategoriesPrismaRepository(db),
    });
    const logger = {
      info: () => undefined,
      warn: (obj: object, msg: string) => console.warn(msg, obj),
    } as unknown as PinoLogger;
    const llm = new LlmService(
      createAnthropicClient(key),
      new LlmMetrics(),
      logger,
    );

    const results = await runAgentEval({
      cases: loadAgentCases(),
      agent: (question) =>
        runAgentLoop({ question, llm, handlers, now: EVAL_NOW }),
      judge: (input) => judgeGrounding(llm, input),
    });

    const baseline = fs.existsSync(BASELINE_FILE)
      ? (JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) as Baseline)
      : undefined;
    const updating = process.argv.includes('--update-baseline');
    const summary = summarizeAnswerRun(results, baseline, updating);

    console.log(
      [
        '## Agent eval (claude-sonnet-5-5, judge claude-opus-5-5)',
        '',
        `**Passed:** ${summary.correct}/${summary.total} · **Errors:** ${summary.errors}`,
        summary.gate
          ? `**Gate:** ${summary.gate.status}: ${summary.gate.message}`
          : '',
        '',
        '| Case | Passed | Outcome | Number | Grounded | Steps |',
        '|---|---|---|---|---|---|',
        ...results.map(
          (r) =>
            `| ${r.id} | ${r.passed ? 'yes' : 'no'} | ${r.outcome} | ${r.numberMatch ?? '-'} | ${r.grounded ?? '-'} | ${r.steps ?? '-'} |`,
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
