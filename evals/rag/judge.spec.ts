import { mock } from 'jest-mock-extended';
import { type LlmService } from '../../src/shared/llm/llm.service';
import { parsedResult, usage } from '../../test/helpers/llm';
import {
  judgeAnswer,
  loadAnswerSet,
  passes,
  runAnswerEval,
  type Verdict,
  summarizeAnswerRun,
} from './judge';
import { nthCall } from '../../test/helpers/must';

const verdict = (v: Partial<Verdict>): Verdict => ({
  reasoning: 'r',
  grounded: true,
  coversKeyPoints: 1,
  citesSources: true,
  ...v,
});

describe('passes', () => {
  it.each([
    [verdict({}), true],
    [verdict({ coversKeyPoints: 0.5 }), true],
    [verdict({ coversKeyPoints: 0.49 }), false],
    [verdict({ grounded: false }), false],
    [verdict({ citesSources: false }), false],
  ])('%o → %s', (v, expected) => {
    expect(passes(v)).toBe(expected);
  });
});

describe('loadAnswerSet', () => {
  it('has 20 cases that reference in-scope queries, each with key points', () => {
    const set = loadAnswerSet();
    expect(set).toHaveLength(20);
    expect(set.every((c) => c.question && c.keyPoints.length > 0)).toBe(true);
  });
});

describe('judgeAnswer', () => {
  const tokens = usage({ input_tokens: 900, output_tokens: 120 });

  it('asks Opus 5.5 at low effort with the question, answer, cited passages and key points', async () => {
    const llm = mock<LlmService>();
    llm.parse.mockResolvedValue(parsedResult(verdict({}), { usage: tokens }));

    await judgeAnswer(llm, {
      question: 'Q?',
      answer: 'A.',
      citedTexts: ['trecho citado'],
      keyPoints: ['ponto 1'],
    });

    const [feature, params] = nthCall(llm.parse.mock);
    expect(feature).toBe('judge');
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.output_config).toEqual(
      expect.objectContaining({ effort: 'low' }),
    );
    const text = JSON.stringify(params.messages);
    for (const s of ['Q?', 'A.', 'trecho citado', 'ponto 1'])
      expect(text).toContain(s);
  });

  it('returns null when the judge output does not parse', async () => {
    const llm = mock<LlmService>();
    llm.parse.mockResolvedValue(parsedResult(null, { usage: tokens }));

    await expect(
      judgeAnswer(llm, {
        question: 'Q',
        answer: 'A',
        citedTexts: [],
        keyPoints: ['p'],
      }),
    ).resolves.toBeNull();
  });
});

type Deps = Parameters<typeof runAnswerEval>[0];
const answerFn = () =>
  jest.fn<ReturnType<Deps['answer']>, Parameters<Deps['answer']>>();
const judgeFn = () =>
  jest.fn<ReturnType<Deps['judge']>, Parameters<Deps['judge']>>();

describe('runAnswerEval', () => {
  const cases = [
    { id: 'q1', question: 'Q1', keyPoints: ['p'] },
    { id: 'q2', question: 'Q2', keyPoints: ['p'] },
    { id: 'q3', question: 'Q3', keyPoints: ['p'] },
  ];

  it('scores answered cases with the judge, fails not-covered ones without judging, and counts a broken judge as an error', async () => {
    const answer = answerFn()
      .mockResolvedValueOnce({
        answer: 'A1',
        citations: [{ citedText: 't', page: 1, chunkId: 'c' }],
        result: 'answered',
      })
      .mockResolvedValueOnce({
        answer: 'n/a',
        citations: [],
        result: 'not_covered',
      })
      .mockResolvedValueOnce({
        answer: 'A3',
        citations: [{ citedText: 't', page: 1, chunkId: 'c' }],
        result: 'answered',
      });
    const judge = judgeFn()
      .mockResolvedValueOnce(verdict({}))
      .mockResolvedValueOnce(null);

    const results = await runAnswerEval({ cases, answer, judge });

    expect(results.map((r) => [r.id, r.passed, r.outcome])).toEqual([
      ['q1', true, 'ok'],
      ['q2', false, 'not_covered'],
      ['q3', false, 'error'],
    ]);
    expect(judge).toHaveBeenCalledTimes(2);
  });
});

describe('summarizeAnswerRun', () => {
  const ok = (id: string, passed: boolean) => ({
    id,
    passed,
    outcome: 'ok' as const,
  });

  it('scores passes and gates against the baseline with a 2-case tolerance', () => {
    const fiveCases = (passed: number) =>
      ['a', 'b', 'c', 'd', 'e'].map((id, i) => ok(id, i < passed));
    const baseline = { correct: 5, total: 5 };

    expect(summarizeAnswerRun(fiveCases(3), baseline, false).correct).toBe(3);
    expect(summarizeAnswerRun(fiveCases(3), baseline, false).gate?.status).toBe(
      'pass',
    );
    const regressed = summarizeAnswerRun(fiveCases(2), baseline, false);
    expect(regressed.gate?.status).toBe('fail');
    expect(regressed.exitCode).toBe(1);
  });

  it('records a new baseline only when no case errored', () => {
    const clean = summarizeAnswerRun(
      [ok('a', true), ok('b', false)],
      undefined,
      true,
    );
    expect(clean.newBaseline).toEqual(
      expect.objectContaining({ correct: 1, total: 2 }),
    );
    expect(clean.gate).toBeUndefined();

    const dirty = summarizeAnswerRun(
      [ok('a', true), { id: 'b', passed: false, outcome: 'error' as const }],
      undefined,
      true,
    );
    expect(dirty.newBaseline).toBeUndefined();
    expect(dirty.exitCode).toBe(1);
  });
});
