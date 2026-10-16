import { compareToBaseline } from './baseline';

const scoreWith = (correct: number) => ({ correct, total: 50 });

describe('compareToBaseline', () => {
  const baseline = { correct: 40, total: 50 };

  it.each([40, 39, 38])('passes at %s correct (within 2 of 40)', (correct) => {
    expect(compareToBaseline(scoreWith(correct), baseline).status).toBe('pass');
  });

  it('fails 3 below the baseline, naming the delta', () => {
    const gate = compareToBaseline(scoreWith(37), baseline);
    expect(gate.status).toBe('fail');
    expect(gate.message).toContain('-3');
  });

  it('passes an improvement and suggests updating the baseline', () => {
    const gate = compareToBaseline(scoreWith(44), baseline);
    expect(gate.status).toBe('pass');
    expect(gate.message).toContain('--update-baseline');
  });

  it('reports no-baseline when none is stored', () => {
    expect(compareToBaseline(scoreWith(40), undefined).status).toBe(
      'no-baseline',
    );
  });

  it('fails, asking for a re-record, when the set size differs from the baseline', () => {
    const gate = compareToBaseline({ correct: 40, total: 51 }, baseline);
    expect(gate.status).toBe('fail');
    expect(gate.message).toContain('51');
    expect(gate.message).toContain('--update-baseline');
  });
});
