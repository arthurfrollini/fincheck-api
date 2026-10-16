export interface Baseline {
  correct: number;
  total: number;
}

export interface GateResult {
  // 'infra': the run itself failed (API down, bad key), so it was never
  // compared. Set by the suite, never by compareToBaseline.
  status: 'pass' | 'fail' | 'no-baseline' | 'infra';
  message: string;
}

// Two cases on a 50-case set: one or two flips are normal model variance,
// three is a regression worth a red build.
export const DEFAULT_TOLERANCE = 2;

export function compareToBaseline(
  score: Baseline,
  baseline: Baseline | undefined,
  tolerance = DEFAULT_TOLERANCE,
): GateResult {
  if (!baseline) {
    return {
      status: 'no-baseline',
      message: 'No stored baseline. Run with --update-baseline to record one.',
    };
  }
  if (score.total !== baseline.total) {
    return {
      status: 'fail',
      message: `Golden set has ${score.total} cases but the baseline was recorded on ${baseline.total}. Re-record it with --update-baseline.`,
    };
  }

  const delta = score.correct - baseline.correct;
  const signed = delta > 0 ? `+${delta}` : `${delta}`;
  const summary = `${score.correct}/${score.total} vs baseline ${baseline.correct}/${baseline.total} (${signed})`;

  if (delta < -tolerance) {
    return {
      status: 'fail',
      message: `Regression: ${summary}, beyond the ${tolerance}-case tolerance.`,
    };
  }
  if (delta > tolerance) {
    return {
      status: 'pass',
      message: `Improvement: ${summary}. If it holds, record it with --update-baseline.`,
    };
  }
  return { status: 'pass', message: `Within tolerance: ${summary}.` };
}
