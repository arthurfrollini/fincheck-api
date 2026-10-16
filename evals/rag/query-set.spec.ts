import { loadQuerySet, validateQuerySet } from './query-set';

describe('loadQuerySet', () => {
  const queries = loadQuerySet();

  it('has 30 in-scope questions, each with evidence, and out-of-scope ones without', () => {
    const inScope = queries.filter((q) => q.inScope);
    expect(inScope).toHaveLength(30);
    expect(inScope.every((q) => q.evidence.length > 0)).toBe(true);
    const outOfScope = queries.filter((q) => !q.inScope);
    expect(outOfScope.length).toBeGreaterThanOrEqual(5);
    expect(outOfScope.every((q) => q.evidence.length === 0)).toBe(true);
  });

  it('has unique ids', () => {
    expect(new Set(queries.map((q) => q.id)).size).toBe(queries.length);
  });
});

describe('validateQuerySet', () => {
  const queries = [
    {
      id: 'q1',
      question: 'x',
      evidence: ['custo de oportunidade'],
      inScope: true,
      source: 'claude' as const,
    },
  ];

  it('passes when every snippet occurs in some chunk', () => {
    expect(() =>
      validateQuerySet(queries, ['O Custo de\noportunidade é...']),
    ).not.toThrow();
  });

  it('throws naming the query and snippet that occur nowhere', () => {
    expect(() => validateQuerySet(queries, ['outro texto'])).toThrow(
      /q1.*custo de oportunidade/,
    );
  });
});
