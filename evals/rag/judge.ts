import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { type LlmService } from '@shared/llm/llm.service';
import { type RagAnswer } from '@modules/education/application/answer-question.service';
import {
  compareToBaseline,
  type Baseline,
  type GateResult,
} from '../lib/baseline';
import { loadQuerySet } from './query-set';

export const JUDGE_MODEL = 'claude-opus-5-5' as const;

// Rubric scores conveyed points, not length, to blunt the judge's known
// bias toward longer answers. Reasoning comes first so the verdict follows
// from it rather than being rationalized after.
const JUDGE_SYSTEM_PROMPT = `You grade answers produced by a retrieval-augmented assistant that answers personal finance questions from excerpts of Banco Central do Brasil's "Caderno de Educação Financeira".

You get the question, the answer, the passages the answer cited, and the key points a good answer must convey.

- grounded: true only if every factual claim in the answer is supported by the cited passages. General connective phrasing is fine; a claim absent from the passages is not.
- coversKeyPoints: the fraction of key points the answer conveys, in any wording, from 0 to 1.
- citesSources: true if the answer cites at least one passage and the cited passages are relevant to the question.

Judge substance, not length or style. A short answer that conveys the key points is as good as a long one. Write your reasoning first, briefly, then the verdict.`;

const verdictSchema = z.object({
  reasoning: z.string(),
  grounded: z.boolean(),
  coversKeyPoints: z.number().min(0).max(1),
  citesSources: z.boolean(),
});
export type Verdict = z.infer<typeof verdictSchema>;

// The API supports neither minimum nor maximum; the range is checked
// client-side by verdictSchema.
const VERDICT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    reasoning: { type: 'string' },
    grounded: { type: 'boolean' },
    coversKeyPoints: { type: 'number', description: 'From 0 to 1.' },
    citesSources: { type: 'boolean' },
  },
  required: ['reasoning', 'grounded', 'coversKeyPoints', 'citesSources'],
  additionalProperties: false,
};

export const passes = (v: Verdict) =>
  v.grounded && v.citesSources && v.coversKeyPoints >= 0.5;

export interface AnswerCase {
  id: string;
  question: string;
  keyPoints: string[];
}

const answerLine = z.object({ id: z.string(), keyPoints: z.array(z.string()) });

export function loadAnswerSet(
  file = path.join(__dirname, 'answers.jsonl'),
): AnswerCase[] {
  const questions = new Map(loadQuerySet().map((q) => [q.id, q]));
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const value: unknown = JSON.parse(line);
      const { id, keyPoints } = answerLine.parse(value);
      const query = questions.get(id);
      if (!query?.inScope) {
        throw new Error(
          `answers.jsonl: ${id} is not an in-scope query in queries.jsonl`,
        );
      }
      return { id, question: query.question, keyPoints };
    });
}

export async function judgeAnswer(
  llm: Pick<LlmService, 'parse'>,
  input: {
    question: string;
    answer: string;
    citedTexts: string[];
    keyPoints: string[];
  },
): Promise<Verdict | null> {
  const body = [
    `<question>${input.question}</question>`,
    `<answer>${input.answer}</answer>`,
    '<cited_passages>',
    ...input.citedTexts.map(
      (t, i) => `<passage index="${i + 1}">${t}</passage>`,
    ),
    '</cited_passages>',
    '<key_points>',
    ...input.keyPoints.map((p) => `- ${p}`),
    '</key_points>',
  ].join('\n');

  const res = await llm.parse(
    'judge',
    {
      model: JUDGE_MODEL,
      max_tokens: 2048,
      system: JUDGE_SYSTEM_PROMPT,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: VERDICT_JSON_SCHEMA },
      },
      messages: [{ role: 'user', content: body }],
    },
    verdictSchema,
  );
  return res.parsed_output;
}

export interface AnswerCaseResult {
  id: string;
  passed: boolean;
  outcome: 'ok' | 'not_covered' | 'refusal' | 'error';
  verdict?: Verdict;
}

export async function runAnswerEval(opts: {
  cases: AnswerCase[];
  answer: (
    question: string,
  ) => Promise<Pick<RagAnswer, 'answer' | 'citations' | 'result'>>;
  judge: (input: Parameters<typeof judgeAnswer>[1]) => Promise<Verdict | null>;
}): Promise<AnswerCaseResult[]> {
  const results: AnswerCaseResult[] = [];
  for (const c of opts.cases) {
    try {
      const rag = await opts.answer(c.question);
      // Every case is in scope: declining to answer is a miss, and there is
      // nothing for the judge to read, so it isn't paid for.
      if (rag.result === 'not_covered' || rag.result === 'refusal') {
        results.push({ id: c.id, passed: false, outcome: rag.result });
        continue;
      }
      const verdict = await opts.judge({
        question: c.question,
        answer: rag.answer,
        citedTexts: rag.citations.map((ct) => ct.citedText),
        keyPoints: c.keyPoints,
      });
      results.push(
        verdict
          ? { id: c.id, passed: passes(verdict), outcome: 'ok', verdict }
          : { id: c.id, passed: false, outcome: 'error' },
      );
    } catch {
      results.push({ id: c.id, passed: false, outcome: 'error' });
    }
  }
  return results;
}

export interface AnswerRunSummary {
  correct: number;
  total: number;
  errors: number;
  gate?: GateResult;
  newBaseline?: Baseline & { recordedAt: string };
  exitCode: number;
}

// Same gate as categorization: the judge varies run to run, so a drop of
// more than 2 of 20 cases fails, a smaller wobble doesn't.
export function summarizeAnswerRun(
  results: { id?: string; passed: boolean; outcome: string }[],
  baseline: Baseline | undefined,
  updateBaseline: boolean,
): AnswerRunSummary {
  const correct = results.filter((r) => r.passed).length;
  const errors = results.filter((r) => r.outcome === 'error').length;
  const score = { correct, total: results.length };

  if (updateBaseline) {
    return errors === 0
      ? {
          ...score,
          errors,
          newBaseline: { ...score, recordedAt: new Date().toISOString() },
          exitCode: 0,
        }
      : { ...score, errors, exitCode: 1 };
  }

  const gate = compareToBaseline(score, baseline);
  return { ...score, errors, gate, exitCode: gate.status === 'fail' ? 1 : 0 };
}
