import { renderReport } from './report';
import { score, type CaseResult } from './score';

const results: CaseResult[] = [
  {
    id: 'r1',
    source: 'real',
    expected: 'Mercado',
    got: 'Mercado',
    outcome: 'ok',
    costUsd: 0.0001,
    latencyMs: 100,
  },
  {
    id: 'r2',
    source: 'real',
    expected: 'Outro',
    got: 'Lazer',
    outcome: 'ok',
    costUsd: 0.0001,
    latencyMs: 100,
  },
];

describe('renderReport', () => {
  const md = renderReport('claude-haiku-5-5', score(results), {
    status: 'pass',
    message: 'within tolerance',
  });

  it('shows the model, accuracy and gate', () => {
    expect(md).toContain('claude-haiku-5-5');
    expect(md).toContain('1/2 (50.0%)');
    expect(md).toContain('within tolerance');
  });

  it('lists every miss with expected and got', () => {
    expect(md).toMatch(/r2.*Outro.*Lazer/);
  });

  it('includes the by-source breakdown', () => {
    expect(md).toMatch(/real.*1\/2/);
  });
});
