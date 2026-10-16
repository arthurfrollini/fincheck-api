import {
  compareRetrieval,
  isRelevant,
  normalize,
  retrievalMetrics,
  separation,
} from './retrieval';

describe('isRelevant', () => {
  it('matches evidence across line breaks, extra spaces and case', () => {
    expect(
      isRelevant('O custo de\n\noportunidade   REFERE-SE ao preço pago', [
        'custo de oportunidade refere-se ao preço',
      ]),
    ).toBe(true);
  });

  it('is true when any of several snippets matches', () => {
    expect(isRelevant('texto sobre juros', ['inexistente', 'juros'])).toBe(
      true,
    );
  });

  it('is false when no snippet occurs', () => {
    expect(isRelevant('texto sobre juros', ['poupança'])).toBe(false);
  });

  it('normalizes whitespace and case', () => {
    expect(normalize('  A\n\nB\tC ')).toBe('a b c');
  });
});

describe('retrievalMetrics', () => {
  it('computes recall@5, hit@1 and MRR@10', () => {
    const m = retrievalMetrics([
      { relevant: [true, false] },
      { relevant: [false, false, true] },
      { relevant: [false, false, false, false, false, false, true] },
      { relevant: [false] },
    ]);
    expect(m.recallAt5).toBeCloseTo(2 / 4);
    expect(m.hitAt1).toBeCloseTo(1 / 4);
    expect(m.mrrAt10).toBeCloseTo((1 + 1 / 3 + 1 / 7 + 0) / 4);
  });
});

describe('separation', () => {
  it('reports the gap between in-scope and out-of-scope best similarities', () => {
    const s = separation([0.88, 0.9, 0.86], [0.8, 0.83]);
    expect(s.minInScope).toBe(0.86);
    expect(s.maxOutOfScope).toBe(0.83);
    expect(s.separable).toBe(true);
    expect(s.suggestedThreshold).toBeCloseTo(0.845);
  });

  it('flags overlapping distributions as not separable', () => {
    const s = separation([0.84, 0.9], [0.85]);
    expect(s.separable).toBe(false);
  });
});

describe('compareRetrieval', () => {
  const baseline = { recallAt5: 0.9, hitAt1: 0.6, mrrAt10: 0.72 };

  it('passes when nothing dropped', () => {
    expect(compareRetrieval({ ...baseline }, baseline).status).toBe('pass');
  });

  it('fails on any drop in recall@5 or MRR@10, naming the metric', () => {
    const recall = compareRetrieval(
      { ...baseline, recallAt5: 0.8667 },
      baseline,
    );
    expect(recall.status).toBe('fail');
    expect(recall.message).toContain('recall@5');
    const mrr = compareRetrieval({ ...baseline, mrrAt10: 0.71 }, baseline);
    expect(mrr.status).toBe('fail');
    expect(mrr.message).toContain('MRR@10');
  });

  it('reports no-baseline when none is stored', () => {
    expect(compareRetrieval(baseline, undefined).status).toBe('no-baseline');
  });
});
