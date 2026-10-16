import { score, type CaseResult } from './score';

function result(fields: Partial<CaseResult>): CaseResult {
  return {
    id: 'x',
    source: 'real',
    expected: 'Mercado',
    got: 'Mercado',
    outcome: 'ok',
    costUsd: 0.0001,
    latencyMs: 100,
    ...fields,
  };
}

const RESULTS: CaseResult[] = [
  result({ id: 'r1', latencyMs: 100 }),
  result({ id: 'r2', expected: 'Lazer', got: 'Lazer', latencyMs: 200 }),
  result({ id: 'r3', expected: 'Outro', got: 'Lazer', latencyMs: 300 }),
  result({
    id: 's1',
    source: 'synthetic',
    expected: 'none',
    got: 'none',
    latencyMs: 400,
  }),
  result({
    id: 's2',
    source: 'synthetic',
    expected: 'Salário',
    got: null,
    outcome: 'error',
    costUsd: 0,
    latencyMs: 500,
  }),
  result({
    id: 's3',
    source: 'synthetic',
    expected: 'Casa',
    got: null,
    outcome: 'refusal',
    latencyMs: 1000,
  }),
];

describe('score', () => {
  const s = score(RESULTS);

  it('computes overall accuracy', () => {
    expect(s.correct).toBe(3);
    expect(s.total).toBe(6);
    expect(s.accuracy).toBeCloseTo(0.5);
  });

  it('breaks results down by source and by expected label', () => {
    expect(s.bySource).toEqual({
      real: { correct: 2, total: 3 },
      synthetic: { correct: 1, total: 3 },
    });
    expect(s.byExpected.Outro).toEqual({ correct: 0, total: 1 });
    expect(s.byExpected.none).toEqual({ correct: 1, total: 1 });
  });

  it('lists every miss, counting errors and refusals as misses', () => {
    expect(s.misses.map((m) => m.id)).toEqual(['r3', 's2', 's3']);
    expect(s.errors).toBe(1);
  });

  it('sums cost and computes latency percentiles', () => {
    expect(s.costUsd).toBeCloseTo(0.0005);
    expect(s.p50LatencyMs).toBe(300);
    expect(s.p95LatencyMs).toBe(1000);
  });
});
