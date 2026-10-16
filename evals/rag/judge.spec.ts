import Anthropic from '@anthropic-ai/sdk';
import {
  judgeAnswer,
  loadAnswerSet,
  passes,
  runAnswerEval,
  type Verdict,
} from './judge';

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
  const usage = {
    input_tokens: 900,
    output_tokens: 120,
    cache_read_input_tokens: null,
    cache_creation_input_tokens: null,
  };

  it('asks Opus 5.5 at low effort with the question, answer, cited passages and key points', async () => {
    const llm = {
      parse: jest.fn().mockResolvedValue({
        stop_reason: 'end_turn',
        parsed_output: verdict({}),
        usage,
      }),
    };

    await judgeAnswer(llm as never, {
      question: 'Q?',
      answer: 'A.',
      citedTexts: ['trecho citado'],
      keyPoints: ['ponto 1'],
    });

    const [feature, params] = llm.parse.mock.calls[0] as [
      string,
      Anthropic.MessageCreateParamsNonStreaming,
    ];
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
    const llm = {
      parse: jest.fn().mockResolvedValue({
        stop_reason: 'end_turn',
        parsed_output: null,
        usage,
      }),
    };

    await expect(
      judgeAnswer(llm as never, {
        question: 'Q',
        answer: 'A',
        citedTexts: [],
        keyPoints: ['p'],
      }),
    ).resolves.toBeNull();
  });
});

describe('runAnswerEval', () => {
  const cases = [
    { id: 'q1', question: 'Q1', keyPoints: ['p'] },
    { id: 'q2', question: 'Q2', keyPoints: ['p'] },
    { id: 'q3', question: 'Q3', keyPoints: ['p'] },
  ];

  it('scores answered cases with the judge, fails not-covered ones without judging, and counts a broken judge as an error', async () => {
    const answer = jest
      .fn()
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
    const judge = jest
      .fn()
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
