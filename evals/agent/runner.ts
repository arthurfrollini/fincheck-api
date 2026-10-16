import {
  type AgentLoopResult,
  type TraceEntry,
} from '@modules/assistant/application/run-agent.service';
import { type AgentCase, expectedValues } from './cases';
import { type GroundingVerdict, matchesExpected } from './grade';

export interface AgentCaseResult {
  id: string;
  passed: boolean;
  outcome: 'ok' | 'degraded' | 'error';
  numberMatch?: boolean;
  grounded?: boolean;
  steps?: number;
}

// A case passes when the expected number(s) appear AND the judge confirms
// every number came from the tool results: right-by-luck answers fail.
export async function runAgentEval(opts: {
  cases: AgentCase[];
  agent: (question: string) => Promise<AgentLoopResult>;
  judge: (input: {
    question: string;
    answer: string;
    trace: TraceEntry[];
  }) => Promise<GroundingVerdict | null>;
}): Promise<AgentCaseResult[]> {
  const results: AgentCaseResult[] = [];
  for (const c of opts.cases) {
    try {
      const run = await opts.agent(c.question);
      if (run.status !== 'COMPLETED') {
        results.push({
          id: c.id,
          passed: false,
          outcome: 'degraded',
          steps: run.steps,
        });
        continue;
      }
      const numberMatch = matchesExpected(run.answer, expectedValues(c));
      if (!numberMatch) {
        // Already a miss; the judge would only cost money.
        results.push({
          id: c.id,
          passed: false,
          outcome: 'ok',
          numberMatch,
          steps: run.steps,
        });
        continue;
      }
      const verdict = await opts.judge({
        question: c.question,
        answer: run.answer,
        trace: run.trace,
      });
      results.push(
        verdict
          ? {
              id: c.id,
              passed: verdict.grounded,
              outcome: 'ok',
              numberMatch,
              grounded: verdict.grounded,
              steps: run.steps,
            }
          : {
              id: c.id,
              passed: false,
              outcome: 'error',
              numberMatch,
              steps: run.steps,
            },
      );
    } catch {
      results.push({ id: c.id, passed: false, outcome: 'error' });
    }
  }
  return results;
}
