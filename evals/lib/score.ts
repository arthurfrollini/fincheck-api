export type CaseOutcome =
  'ok' | 'refusal' | 'max_tokens' | 'unparsed' | 'error';

export interface CaseResult {
  id: string;
  source: 'real' | 'synthetic';
  expected: string;
  // A category name or 'none'; null when the call produced no usable answer.
  got: string | null;
  outcome: CaseOutcome;
  costUsd: number;
  latencyMs: number;
}

interface Tally {
  correct: number;
  total: number;
}

export interface Score extends Tally {
  accuracy: number;
  bySource: Record<string, Tally>;
  byExpected: Record<string, Tally>;
  misses: CaseResult[];
  errors: number;
  costUsd: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

function tally(map: Record<string, Tally>, key: string, hit: boolean): void {
  map[key] ??= { correct: 0, total: 0 };
  map[key].total += 1;
  if (hit) map[key].correct += 1;
}

// Nearest-rank percentile: always an observed value, no interpolation.
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.ceil(p * sorted.length) - 1];
}

export function score(results: CaseResult[]): Score {
  const bySource: Record<string, Tally> = {};
  const byExpected: Record<string, Tally> = {};
  const misses: CaseResult[] = [];

  for (const r of results) {
    const hit = r.got === r.expected;
    tally(bySource, r.source, hit);
    tally(byExpected, r.expected, hit);
    if (!hit) misses.push(r);
  }

  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const correct = results.length - misses.length;

  return {
    correct,
    total: results.length,
    accuracy: results.length === 0 ? 0 : correct / results.length,
    bySource,
    byExpected,
    misses,
    errors: results.filter((r) => r.outcome === 'error').length,
    costUsd: results.reduce((sum, r) => sum + r.costUsd, 0),
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
  };
}
