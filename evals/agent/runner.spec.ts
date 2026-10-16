import type Anthropic from '@anthropic-ai/sdk';
import { judgeGrounding } from './grade';
import { runAgentEval } from './runner';

const trace = [
  {
    tool: 'compute_totals',
    input: { from: '2026-09-01' },
    result: { grandTotal: 302.37 },
    isError: false,
  },
];
const cases = [
  {
    id: 'a01',
    question: 'Q1',
    derivations: [
      {
        from: '2026-09-01',
        to: '2026-09-30',
        type: 'EXPENSE' as const,
        category: 'Alimentação',
        op: 'sum' as const,
      },
    ],
    source: 'claude' as const,
  },
];

describe('runAgentEval', () => {
  it('passes a case only when the number matches and the judge says grounded', async () => {
    const agent = jest.fn().mockResolvedValue({
      status: 'COMPLETED',
      answer: 'R$ 302,37',
      steps: 2,
      trace,
    });
    const judge = jest
      .fn()
      .mockResolvedValueOnce({ reasoning: 'r', grounded: true });

    const [r] = await runAgentEval({ cases, agent, judge });

    expect(r).toEqual(
      expect.objectContaining({
        id: 'a01',
        passed: true,
        outcome: 'ok',
        numberMatch: true,
        grounded: true,
      }),
    );
    expect(judge).toHaveBeenCalledWith({
      question: 'Q1',
      answer: 'R$ 302,37',
      trace,
    });
  });

  it('fails a right number the judge finds ungrounded', async () => {
    const agent = jest.fn().mockResolvedValue({
      status: 'COMPLETED',
      answer: 'R$ 302,37',
      steps: 1,
      trace: [],
    });
    const judge = jest
      .fn()
      .mockResolvedValue({ reasoning: 'no tool call', grounded: false });

    const [r] = await runAgentEval({ cases, agent, judge });

    expect(r.passed).toBe(false);
  });

  it('fails a wrong number without paying for the judge', async () => {
    const agent = jest.fn().mockResolvedValue({
      status: 'COMPLETED',
      answer: 'R$ 300,00',
      steps: 2,
      trace,
    });
    const judge = jest.fn();

    const [r] = await runAgentEval({ cases, agent, judge });

    expect(r).toEqual(
      expect.objectContaining({ passed: false, numberMatch: false }),
    );
    expect(judge).not.toHaveBeenCalled();
  });

  it('counts a degraded run as a miss and a crash or broken judge as an error', async () => {
    const twoCases = [
      cases[0],
      { ...cases[0], id: 'a02' },
      { ...cases[0], id: 'a03' },
    ];
    const agent = jest
      .fn()
      .mockResolvedValueOnce({
        status: 'DEGRADED',
        answer: 'x',
        steps: 6,
        trace,
      })
      .mockRejectedValueOnce(new Error('api down'))
      .mockResolvedValueOnce({
        status: 'COMPLETED',
        answer: 'R$ 302,37',
        steps: 2,
        trace,
      });
    const judge = jest.fn().mockResolvedValue(null);

    const results = await runAgentEval({ cases: twoCases, agent, judge });

    expect(results.map((r) => [r.id, r.outcome, r.passed])).toEqual([
      ['a01', 'degraded', false],
      ['a02', 'error', false],
      ['a03', 'error', false],
    ]);
  });
});

describe('judgeGrounding', () => {
  it('asks Opus 5.5 at low effort and shows it every tool call and result', async () => {
    const llm = {
      parse: jest.fn().mockResolvedValue({
        parsed_output: { reasoning: 'r', grounded: true },
      }),
    };

    await judgeGrounding(llm as never, { question: 'Q', answer: 'A', trace });

    const [feature, params] = llm.parse.mock.calls[0] as [
      string,
      Anthropic.MessageCreateParamsNonStreaming,
    ];
    expect(feature).toBe('judge');
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.output_config).toEqual(
      expect.objectContaining({ effort: 'low' }),
    );
    expect(JSON.stringify(params.messages)).toContain('302.37');
  });
});
