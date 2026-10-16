// Runs the categorization golden set against the real Claude API.
//
//   npm run eval:categorization -- --models claude-haiku-5-5,claude-opus-5-5 \
//     [--out eval-result.json] [--update-baseline]
//
// Only claude-haiku-5-5 (the production model) is gated. Exit 1 on a gated
// regression or an infra failure.
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PinoLogger } from 'nestjs-pino';
import { createAnthropicClient } from '@shared/llm/anthropic-client';
import { LlmMetrics } from '@shared/llm/llm.metrics';
import { LlmService } from '@shared/llm/llm.service';
import { type LlmModel } from '@shared/llm/llm-pricing';
import { CATEGORIZATION_MODEL } from '@modules/transactions/application/categorization.constants';
import { compareToBaseline, type Baseline } from '../lib/baseline';
import { renderReport } from '../lib/report';
import { score } from '../lib/score';
import { loadGoldenSet } from './golden-set';
import {
  assertRealKey,
  canUpdateBaseline,
  runCategorizationEval,
  shouldFailAsInfra,
} from './runner';

dotenv.config();

const BASELINE_FILE = path.resolve(
  __dirname,
  '../baselines/categorization.json',
);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function readBaselines(): Record<string, Baseline & { recordedAt: string }> {
  return fs.existsSync(BASELINE_FILE)
    ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
    : {};
}

async function main(): Promise<number> {
  const key = process.env.ANTHROPIC_API_KEY;
  assertRealKey(key);

  const models = (arg('models') ?? CATEGORIZATION_MODEL).split(
    ',',
  ) as LlmModel[];
  const updateBaseline = process.argv.includes('--update-baseline');
  const cases = loadGoldenSet();
  const baselines = readBaselines();

  // Not wrapped in Nest: no app, no database, no env.ts. The OTel meter is a
  // no-op without the SDK registered, so metrics calls are free here. Per-call
  // info logs are dropped; the report below is the output.
  const logger = {
    info: () => undefined,
    warn: (obj: object, msg: string) => console.warn(msg, obj),
  } as unknown as PinoLogger;
  const llm = new LlmService(
    createAnthropicClient(key),
    new LlmMetrics(),
    logger,
  );

  const output: Record<string, unknown> = {};
  let exitCode = 0;

  for (const model of models) {
    const result = score(await runCategorizationEval({ llm, model, cases }));

    if (shouldFailAsInfra(result.errors)) {
      console.error(
        `${model}: ${result.errors} cases errored, failing as infra. Baseline not compared.`,
      );
      output[model] = { score: result, gate: { status: 'infra' } };
      exitCode = 1;
      continue;
    }

    const gated = model === CATEGORIZATION_MODEL;
    const gate = gated
      ? compareToBaseline(result, baselines[model])
      : undefined;
    if (gate?.status === 'fail') exitCode = 1;

    console.log(renderReport(model, result, gate) + '\n');
    output[model] = { score: result, gate };

    if (updateBaseline) {
      if (!canUpdateBaseline(result.errors)) {
        console.error(
          `${model}: not updating the baseline, ${result.errors} cases errored.`,
        );
        exitCode = 1;
      } else {
        baselines[model] = {
          correct: result.correct,
          total: result.total,
          recordedAt: new Date().toISOString(),
        };
      }
    }
  }

  if (updateBaseline) {
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(baselines, null, 2)}\n`);
  }
  const out = arg('out');
  if (out)
    fs.writeFileSync(out, `${JSON.stringify({ models: output }, null, 2)}\n`);

  return exitCode;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
