import { type GateResult } from './baseline';
import { type Score } from './score';

const pct = (correct: number, total: number) =>
  `${correct}/${total} (${total === 0 ? '0.0' : ((correct / total) * 100).toFixed(1)}%)`;

export function renderReport(
  model: string,
  score: Score,
  gate?: GateResult,
): string {
  const lines = [
    `## Categorization eval: \`${model}\``,
    '',
    `**Accuracy:** ${pct(score.correct, score.total)}`,
    `**Cost:** $${score.costUsd.toFixed(4)} · **Latency:** p50 ${score.p50LatencyMs} ms, p95 ${score.p95LatencyMs} ms · **Errors:** ${score.errors}`,
  ];
  if (gate) lines.push(`**Gate:** ${gate.status}: ${gate.message}`);

  lines.push('', '| Source | Correct |', '|---|---|');
  for (const [source, t] of Object.entries(score.bySource)) {
    lines.push(`| ${source} | ${pct(t.correct, t.total)} |`);
  }

  if (score.misses.length > 0) {
    lines.push('', '| Case | Expected | Got | Outcome |', '|---|---|---|---|');
    for (const m of score.misses) {
      lines.push(
        `| ${m.id} | ${m.expected} | ${m.got ?? '-'} | ${m.outcome} |`,
      );
    }
  }

  return lines.join('\n');
}
