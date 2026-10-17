import { must } from '../../test/helpers/must';
import { loadAgentCases, expectedValues } from './cases';
import { SEED } from './seed';

describe('agent eval seed and cases', () => {
  const cases = loadAgentCases();
  const caseById = (id: string) =>
    must(
      cases.find((c) => c.id === id),
      `case ${id}`,
    );

  it('seeds 40 transactions over August and September 2026', () => {
    expect(SEED).toHaveLength(40);
    expect(
      SEED.every((t) => t.date >= '2026-08-01' && t.date <= '2026-09-30'),
    ).toBe(true);
  });

  it('has 10 cases, each with expected values derived from the seed', () => {
    expect(cases).toHaveLength(10);
    expect(expectedValues(caseById('a01'))).toEqual([302.37]);
    expect(expectedValues(caseById('a03'))).toEqual([8212.37]);
    expect(expectedValues(caseById('a04'))).toEqual([1800]);
    expect(expectedValues(caseById('a06'))).toEqual([595.45, 562.45]);
    expect(expectedValues(caseById('a07'))).toEqual([573.9]);
    expect(expectedValues(caseById('a10'))).toEqual([100]);
  });

  it('every case resolves to at least one non-zero number', () => {
    for (const c of cases) {
      const values = expectedValues(c);
      expect(values.length).toBeGreaterThan(0);
      expect(values.every((v) => v !== 0)).toBe(true);
    }
  });
});
