// Runs the categorization golden set against the real Claude API.
//
//   npm run eval:categorization -- --models claude-haiku-5-5,claude-opus-5-5 \
//     [--out eval-result.json] [--update-baseline]
//
// Only claude-haiku-5-5 (the production model) is gated and baselined.
// Exit 1 on a gated regression, a refused baseline update, or an infra failure.
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createAnthropicClient } from '@shared/llm/anthropic-client';
import { LlmMetrics } from '@shared/llm/llm.metrics';
import { LlmService } from '@shared/llm/llm.service';
import { CATEGORIZATION_MODEL } from '@modules/transactions/application/categorization.constants';
import { loadGoldenSet } from './golden-set';
import { assertRealKey } from './runner';
import { parseModels, runEvalSuite, type StoredBaselines } from './suite';
import { createEvalLogger } from '../lib/eval-logger';

dotenv.config();

const BASELINE_FILE = path.resolve(
  __dirname,
  '../baselines/categorization.json',
);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const toJson = (data: unknown) => `${JSON.stringify(data, null, 2)}\n`;

async function main(): Promise<number> {
  const key = process.env.ANTHROPIC_API_KEY;
  assertRealKey(key);
  const models = parseModels(arg('models') ?? CATEGORIZATION_MODEL);

  // Not wrapped in Nest: no app, no database, no env.ts. The OTel meter is a
  // no-op without the SDK registered. Per-call info logs are dropped; the
  // report is the output.
  const logger = createEvalLogger();

  return runEvalSuite({
    llm: new LlmService(createAnthropicClient(key), new LlmMetrics(), logger),
    models,
    cases: loadGoldenSet(),
    updateBaseline: process.argv.includes('--update-baseline'),
    out: arg('out'),
    io: {
      readBaselines: () =>
        fs.existsSync(BASELINE_FILE)
          ? (JSON.parse(
              fs.readFileSync(BASELINE_FILE, 'utf8'),
            ) as StoredBaselines)
          : {},
      writeBaselines: (b) => fs.writeFileSync(BASELINE_FILE, toJson(b)),
      writeOut: (file, data) => fs.writeFileSync(file, toJson(data)),
      log: (line) => console.log(line),
      error: (line) => console.error(line),
    },
  });
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
