import { type LlmService } from '@shared/llm/llm.service';
import { LLM_PRICING, type LlmModel } from '@shared/llm/llm-pricing';
import { CATEGORIZATION_MODEL } from '@modules/transactions/application/categorization.constants';
import {
  compareToBaseline,
  type Baseline,
  type GateResult,
} from '../lib/baseline';
import { renderReport } from '../lib/report';
import { score, type Score } from '../lib/score';
import { type GoldenCase } from './golden-set';
import {
  canUpdateBaseline,
  runCategorizationEval,
  shouldFailAsInfra,
} from './runner';

export type StoredBaselines = Record<string, Baseline & { recordedAt: string }>;

export interface SuiteIO {
  readBaselines(): StoredBaselines;
  writeBaselines(baselines: StoredBaselines): void;
  writeOut(path: string, data: unknown): void;
  log(line: string): void;
  error(line: string): void;
}

export interface SuiteOptions {
  llm: Pick<LlmService, 'parse'>;
  models: LlmModel[];
  cases: GoldenCase[];
  updateBaseline: boolean;
  out?: string;
  io: SuiteIO;
  sleep?: (ms: number) => Promise<void>;
}

type ModelOutput = { score: Score; gate?: GateResult };

export function parseModels(raw: string): LlmModel[] {
  return raw.split(',').map((name) => {
    const model = name.trim();
    if (!(model in LLM_PRICING)) {
      throw new Error(
        `Unknown model "${model}". Known: ${Object.keys(LLM_PRICING).join(', ')}.`,
      );
    }
    return model as LlmModel;
  });
}

// Only the production model is gated and only its baseline is recorded:
// other models are run for comparison, never as a pass/fail bar.
export async function runEvalSuite(opts: SuiteOptions): Promise<number> {
  const { io, updateBaseline } = opts;
  const baselines = io.readBaselines();
  const output: Record<string, ModelOutput> = {};
  let exitCode = 0;
  let newBaseline: (Baseline & { recordedAt: string }) | undefined;
  let baselineRefused = false;

  for (const model of opts.models) {
    const gated = model === CATEGORIZATION_MODEL;
    const result = score(
      await runCategorizationEval({
        llm: opts.llm,
        model,
        cases: opts.cases,
        sleep: opts.sleep,
      }),
    );

    if (shouldFailAsInfra(result.errors)) {
      const gate: GateResult = {
        status: 'infra',
        message: `${result.errors} cases errored: the API or the key is the problem, not the model. Baseline not compared.`,
      };
      io.log(renderReport(model, result, gate) + '\n');
      output[model] = { score: result, gate };
      exitCode = 1;
      if (gated) baselineRefused = true;
      continue;
    }

    // When re-recording, the old baseline is being replaced, so comparing
    // against it (possibly recorded on a different set size) is moot.
    const gate =
      gated && !updateBaseline
        ? compareToBaseline(result, baselines[model])
        : undefined;
    if (gate?.status === 'fail') exitCode = 1;

    io.log(renderReport(model, result, gate) + '\n');
    output[model] = { score: result, gate };

    if (gated && updateBaseline) {
      if (canUpdateBaseline(result.errors)) {
        newBaseline = {
          correct: result.correct,
          total: result.total,
          recordedAt: new Date().toISOString(),
        };
      } else {
        io.error(
          `${model}: not updating the baseline, ${result.errors} cases errored.`,
        );
        baselineRefused = true;
        exitCode = 1;
      }
    }
  }

  if (updateBaseline && newBaseline && !baselineRefused) {
    io.writeBaselines({ ...baselines, [CATEGORIZATION_MODEL]: newBaseline });
  }
  if (opts.out) io.writeOut(opts.out, { models: output });

  return exitCode;
}
