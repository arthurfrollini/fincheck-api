export const normalize = (s: string) =>
  s.replace(/\s+/g, ' ').trim().toLowerCase();

// A chunk is relevant to a query when it contains one of the query's evidence
// snippets. Labels are text, not chunk ids, so they stay valid when the
// chunking strategy changes: that is what makes chunking an experiment.
export function isRelevant(chunkText: string, evidence: string[]): boolean {
  const text = normalize(chunkText);
  return evidence.some((snippet) => text.includes(normalize(snippet)));
}

export interface RetrievalMetrics {
  recallAt5: number;
  hitAt1: number;
  mrrAt10: number;
}

export function retrievalMetrics(
  rankings: { relevant: boolean[] }[],
): RetrievalMetrics {
  const n = rankings.length || 1;
  const firstHit = rankings.map((r) => r.relevant.indexOf(true));
  return {
    recallAt5: firstHit.filter((i) => i >= 0 && i < 5).length / n,
    hitAt1: firstHit.filter((i) => i === 0).length / n,
    mrrAt10:
      firstHit.reduce(
        (sum, i) => sum + (i >= 0 && i < 10 ? 1 / (i + 1) : 0),
        0,
      ) / n,
  };
}

// Calibrates RAG_MIN_SIMILARITY: the best-chunk similarity of questions the
// material covers vs questions it doesn't. multilingual-e5 compresses scores,
// so the gap, not an intuitive number, decides the threshold.
export function separation(inScopeBest: number[], outOfScopeBest: number[]) {
  const minInScope = Math.min(...inScopeBest);
  const maxOutOfScope = Math.max(...outOfScopeBest);
  return {
    minInScope,
    maxOutOfScope,
    separable: minInScope > maxOutOfScope,
    suggestedThreshold: (minInScope + maxOutOfScope) / 2,
  };
}

// Embeddings and search are deterministic, so any drop is a real regression
// (a chunking or embedding change made retrieval worse), not variance.
const EPSILON = 1e-9;

export function compareRetrieval(
  current: RetrievalMetrics,
  baseline: RetrievalMetrics | undefined,
): { status: 'pass' | 'fail' | 'no-baseline'; message: string } {
  if (!baseline) {
    return {
      status: 'no-baseline',
      message: 'No stored baseline. Run with --update-baseline to record one.',
    };
  }
  const drops = [
    ['recall@5', current.recallAt5, baseline.recallAt5],
    ['MRR@10', current.mrrAt10, baseline.mrrAt10],
  ]
    .filter(([, now, before]) => (now as number) < (before as number) - EPSILON)
    .map(
      ([name, now, before]) =>
        `${name} ${(before as number).toFixed(3)} → ${(now as number).toFixed(3)}`,
    );
  return drops.length > 0
    ? { status: 'fail', message: `Retrieval regressed: ${drops.join(', ')}.` }
    : { status: 'pass', message: 'No drop against the baseline.' };
}
