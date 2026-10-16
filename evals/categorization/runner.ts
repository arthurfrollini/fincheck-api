import Anthropic from '@anthropic-ai/sdk';
import { type LlmService } from '@shared/llm/llm.service';
import { computeCostUsd, type LlmModel } from '@shared/llm/llm-pricing';
import { DEFAULT_CATEGORIES } from '@modules/categories/entities/default-categories';
import {
  buildCategorizationRequest,
  interpretAnswer,
} from '@modules/transactions/application/categorize-transaction.service';
import { NO_CATEGORY } from '@modules/transactions/application/categorization.constants';
import { type CaseOutcome, type CaseResult } from '../lib/score';
import { type GoldenCase } from './golden-set';

// One fixed id per default category, so a run is reproducible and the
// answer maps back to a name. Two categories are both named "Outro"; the
// (name, type) pair is what is unique.
export const EVAL_CATEGORIES = DEFAULT_CATEGORIES.map((c, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  name: c.name,
  type: c.type,
}));

const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;
const MAX_ERRORED_CASES = 5;

export interface EvalOptions {
  llm: Pick<LlmService, 'parse'>;
  model: LlmModel;
  cases: GoldenCase[];
  concurrency?: number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function isTransient(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (!(err instanceof Anthropic.APIError)) return false;
  const status = err.status ?? 0;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function runCase(
  c: GoldenCase,
  opts: Required<Omit<EvalOptions, 'cases' | 'concurrency'>>,
): Promise<CaseResult> {
  const candidates = EVAL_CATEGORIES.filter((cat) => cat.type === c.type);
  const { params, schema } = buildCategorizationRequest(
    c,
    candidates,
    opts.model,
  );
  const base = { id: c.id, source: c.source, expected: c.expected };

  for (let attempt = 1; ; attempt++) {
    const startedAt = performance.now();
    try {
      const res = await opts.llm.parse('categorization', params, schema, {
        evalCase: c.id,
      });
      const latencyMs = Math.round(performance.now() - startedAt);
      const costUsd = computeCostUsd(opts.model, res.usage);

      let outcome: CaseOutcome = 'ok';
      if (res.stop_reason === 'refusal') outcome = 'refusal';
      else if (res.stop_reason === 'max_tokens') outcome = 'max_tokens';
      else if (!res.parsed_output) outcome = 'unparsed';

      let got: string | null = null;
      if (outcome === 'ok' && res.parsed_output) {
        const id = interpretAnswer(res.parsed_output);
        got = id
          ? (candidates.find((cat) => cat.id === id)?.name ?? null)
          : NO_CATEGORY;
      }
      return { ...base, got, outcome, costUsd, latencyMs };
    } catch (err) {
      if (attempt < MAX_ATTEMPTS && isTransient(err)) {
        await opts.sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }
      return { ...base, got: null, outcome: 'error', costUsd: 0, latencyMs: 0 };
    }
  }
}

export async function runCategorizationEval({
  llm,
  model,
  cases,
  concurrency = 5,
  sleep = realSleep,
}: EvalOptions): Promise<CaseResult[]> {
  const results: CaseResult[] = new Array<CaseResult>(cases.length);
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const index = next++;
      results[index] = await runCase(cases[index], { llm, model, sleep });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// Too many failed calls means the API or the key is the problem, not the
// model: comparing that run to the baseline would report a fake regression.
export function shouldFailAsInfra(errors: number): boolean {
  return errors > MAX_ERRORED_CASES;
}

export function canUpdateBaseline(errors: number): boolean {
  return errors === 0;
}

export function assertRealKey(key: string | undefined): asserts key is string {
  if (!key || key.startsWith('fake-')) {
    throw new Error(
      'Set a real ANTHROPIC_API_KEY to run the eval (it calls the Claude API).',
    );
  }
}
