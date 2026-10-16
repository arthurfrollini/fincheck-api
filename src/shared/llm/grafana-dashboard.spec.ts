import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const DASHBOARD = path.join(
  ROOT,
  'docker/grafana/provisioning/dashboards/fincheck-llm.json',
);

// Every counter the app registers, as the OTel Prometheus exporter names it
// (monotonic counters get a _total suffix).
function exportedCounters(): Set<string> {
  const names = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        const source = fs.readFileSync(full, 'utf8');
        for (const m of source.matchAll(/createCounter\(\s*'([a-z_]+)'/g))
          names.add(`${m[1]}_total`);
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  return names;
}

describe('Grafana LLM dashboard', () => {
  const dashboard = JSON.parse(fs.readFileSync(DASHBOARD, 'utf8')) as {
    uid: string;
    title: string;
    panels: { title: string; targets?: { expr: string }[] }[];
  };
  const exprs = dashboard.panels.flatMap((p) =>
    (p.targets ?? []).map((t) => t.expr),
  );

  it('has a stable uid and title so links to it keep working', () => {
    expect(dashboard.uid).toBe('fincheck-llm');
    expect(dashboard.title).toBe('fincheck · LLM');
  });

  it('only queries metrics the app actually exports', () => {
    const exported = exportedCounters();
    const used = new Set(
      exprs.flatMap((e) => e.match(/fincheck_[a-z_]+/g) ?? []),
    );
    expect(used.size).toBeGreaterThan(0);
    for (const metric of used) expect(exported).toContain(metric);
  });

  it('covers cost, tokens and outcomes for every LLM feature, plus each feature result', () => {
    const all = exprs.join('\n');
    for (const metric of [
      'fincheck_llm_cost_usd_total',
      'fincheck_llm_tokens_total',
      'fincheck_llm_requests_total',
      'fincheck_categorization_results_total',
      'fincheck_rag_results_total',
      'fincheck_agent_runs_total',
      'fincheck_agent_steps_total',
    ]) {
      expect(all).toContain(metric);
    }
  });
});
