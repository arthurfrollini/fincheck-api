import Anthropic from '@anthropic-ai/sdk';
import { RunAgentService, runAgentLoop } from './run-agent.service';
import {
  AGENT_MODEL,
  FAILED_ANSWER,
  INCOMPLETE_ANSWER,
  MAX_STEPS,
  REFUSAL_ANSWER,
  TOOL_FAILURE_ANSWER,
} from './agent.constants';
import { type ToolHandlers } from './agent-tools';

const usage = {
  input_tokens: 500,
  output_tokens: 80,
  cache_read_input_tokens: null,
  cache_creation_input_tokens: null,
};
const thinking = { type: 'thinking', thinking: '', signature: 'sig' };

function toolCall(...calls: [string, unknown][]) {
  return {
    role: 'assistant',
    content: [
      thinking,
      ...calls.map(([name, input], i) => ({
        type: 'tool_use',
        id: `tu-${name}-${i}`,
        name,
        input,
      })),
    ],
    stop_reason: 'tool_use',
    usage,
  } as unknown as Anthropic.Message;
}
const final = (text: string) =>
  ({
    role: 'assistant',
    content: [thinking, { type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    usage,
  }) as unknown as Anthropic.Message;

function handlers(overrides: Partial<ToolHandlers> = {}): ToolHandlers {
  return {
    fetch_categories: jest
      .fn()
      .mockResolvedValue([{ id: 'c1', name: 'Alimentação', type: 'EXPENSE' }]),
    query_transactions: jest
      .fn()
      .mockResolvedValue({ transactions: [], total: 0, truncated: false }),
    compute_totals: jest
      .fn()
      .mockResolvedValue({ groups: [], grandTotal: 412.37 }),
    ...overrides,
  };
}

const NOW = new Date('2026-10-16T12:00:00Z');
const totals: [string, unknown] = [
  'compute_totals',
  { from: '2026-09-01', to: '2026-09-30', groupBy: 'none' },
];

describe('runAgentLoop', () => {
  it('runs tools until the model answers, appending each assistant turn unchanged', async () => {
    const first = toolCall(totals);
    const llm = {
      complete: jest
        .fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(final('Você gastou R$ 412,37.')),
    };

    const result = await runAgentLoop({
      question: 'quanto gastei?',
      llm: llm,
      handlers: handlers(),
      now: NOW,
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'COMPLETED',
        answer: 'Você gastou R$ 412,37.',
        steps: 2,
      }),
    );
    const secondCall = llm.complete.mock
      .calls[1][1] as Anthropic.MessageCreateParamsNonStreaming;
    expect(secondCall.messages[1]).toEqual({
      role: 'assistant',
      content: first.content,
    });
    expect(result.trace).toEqual([
      {
        tool: 'compute_totals',
        input: totals[1],
        result: { groups: [], grandTotal: 412.37 },
        isError: false,
      },
    ]);
  });

  it('returns every result of a parallel tool round in one user message, in order', async () => {
    const llm = {
      complete: jest
        .fn()
        .mockResolvedValueOnce(toolCall(['fetch_categories', {}], totals))
        .mockResolvedValueOnce(final('ok')),
    };

    await runAgentLoop({
      question: 'q',
      llm: llm,
      handlers: handlers(),
      now: NOW,
    });

    const messages = (
      llm.complete.mock.calls[1][1] as Anthropic.MessageCreateParamsNonStreaming
    ).messages;
    // The mock holds the live array, so later turns are appended to it;
    // the round under test is the third message.
    const results = messages[2].content as Anthropic.ToolResultBlockParam[];
    expect(messages[2].role).toBe('user');
    expect(results.map((r) => r.tool_use_id)).toEqual([
      'tu-fetch_categories-0',
      'tu-compute_totals-1',
    ]);
  });

  it('degrades after the step limit without a final answer', async () => {
    const llm = { complete: jest.fn().mockResolvedValue(toolCall(totals)) };

    const result = await runAgentLoop({
      question: 'q',
      llm: llm,
      handlers: handlers(),
      now: NOW,
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'DEGRADED',
        answer: INCOMPLETE_ANSWER,
        steps: MAX_STEPS,
      }),
    );
    expect(llm.complete).toHaveBeenCalledTimes(MAX_STEPS);
  });

  it('degrades after two consecutive rounds where every tool failed', async () => {
    const llm = { complete: jest.fn().mockResolvedValue(toolCall(totals)) };
    const failing = handlers({
      compute_totals: jest.fn().mockRejectedValue(new Error('db down')),
    });

    const result = await runAgentLoop({
      question: 'q',
      llm: llm,
      handlers: failing,
      now: NOW,
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'DEGRADED',
        answer: TOOL_FAILURE_ANSWER,
        steps: 2,
      }),
    );
  });

  it('recovers when a failed round is followed by a working one', async () => {
    const flaky = jest
      .fn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue({ groups: [], grandTotal: 1 });
    const llm = {
      complete: jest
        .fn()
        .mockResolvedValueOnce(toolCall(totals))
        .mockResolvedValueOnce(toolCall(totals))
        .mockResolvedValueOnce(final('ok')),
    };

    const result = await runAgentLoop({
      question: 'q',
      llm: llm,
      handlers: handlers({ compute_totals: flaky }),
      now: NOW,
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.trace.map((t) => t.isError)).toEqual([true, false]);
  });

  it('does not run tools from a response cut off by max_tokens', async () => {
    const cut = {
      ...toolCall(totals),
      stop_reason: 'max_tokens',
    } as Anthropic.Message;
    const llm = { complete: jest.fn().mockResolvedValue(cut) };
    const h = handlers();

    const result = await runAgentLoop({
      question: 'q',
      llm: llm,
      handlers: h,
      now: NOW,
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'DEGRADED',
        answer: INCOMPLETE_ANSWER,
        steps: 1,
      }),
    );
    expect(h.compute_totals).not.toHaveBeenCalled();
  });

  it('leaves room for adaptive thinking plus the answer', async () => {
    const llm = { complete: jest.fn().mockResolvedValue(final('ok')) };
    await runAgentLoop({
      question: 'q',
      llm: llm,
      handlers: handlers(),
      now: NOW,
    });
    expect(
      (llm.complete.mock.calls[0][1] as { max_tokens: number }).max_tokens,
    ).toBeGreaterThanOrEqual(16000);
  });

  it('degrades on refusal', async () => {
    const llm = {
      complete: jest.fn().mockResolvedValue({
        role: 'assistant',
        content: [],
        stop_reason: 'refusal',
        usage,
      }),
    };

    const result = await runAgentLoop({
      question: 'q',
      llm: llm,
      handlers: handlers(),
      now: NOW,
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'DEGRADED',
        answer: REFUSAL_ANSWER,
        steps: 1,
      }),
    );
  });

  it('propagates Claude API errors so the job can be retried', async () => {
    const error = new Anthropic.RateLimitError(
      429,
      undefined,
      'x',
      new Headers(),
    );
    const llm = { complete: jest.fn().mockRejectedValue(error) };

    await expect(
      runAgentLoop({
        question: 'q',
        llm: llm,
        handlers: handlers(),
        now: NOW,
      }),
    ).rejects.toBe(error);
  });

  it('asks Sonnet 5.5 at medium effort with the tools, today in the system prompt and the question only in the messages', async () => {
    const llm = { complete: jest.fn().mockResolvedValue(final('ok')) };

    await runAgentLoop({
      question: 'quanto gastei com comida?',
      llm: llm,
      handlers: handlers(),
      now: NOW,
    });

    const [feature, params] = llm.complete.mock.calls[0] as [
      string,
      Anthropic.MessageCreateParamsNonStreaming,
    ];
    expect(feature).toBe('agent');
    expect(params.model).toBe(AGENT_MODEL);
    expect(params.output_config).toEqual({ effort: 'medium' });
    expect(params.tools?.map((t) => (t as Anthropic.Tool).name)).toEqual([
      'fetch_categories',
      'query_transactions',
      'compute_totals',
    ]);
    expect(params).not.toHaveProperty('tool_choice');
    expect(params.system).toContain('2026-10-16');
    expect(params.system).not.toContain('comida');
    expect(params.messages[0]).toEqual({
      role: 'user',
      content: 'quanto gastei com comida?',
    });
  });
});

describe('RunAgentService', () => {
  const base = {
    id: 'run-1',
    userId: 'u1',
    idempotencyKey: null,
    question: 'q',
    answer: null,
    steps: 0,
  };
  let repo: { findById: jest.Mock; markRunning: jest.Mock; finish: jest.Mock };
  let llm: { complete: jest.Mock };
  let service: RunAgentService;
  let logger: { info: jest.Mock; warn: jest.Mock };

  beforeEach(() => {
    repo = { findById: jest.fn(), markRunning: jest.fn(), finish: jest.fn() };
    llm = { complete: jest.fn().mockResolvedValue(final('R$ 10,00')) };
    logger = { info: jest.fn(), warn: jest.fn() };
    service = new RunAgentService(
      repo as never,
      { search: jest.fn(), totals: jest.fn() } as never,
      { findAllByUserId: jest.fn() } as never,
      llm as never,
      logger as never,
    );
  });

  it('runs a queued run and records the result', async () => {
    repo.findById.mockResolvedValue({ ...base, status: 'QUEUED' });

    await service.run('run-1');

    expect(repo.markRunning).toHaveBeenCalledWith('run-1');
    expect(repo.finish).toHaveBeenCalledWith('run-1', {
      status: 'COMPLETED',
      answer: 'R$ 10,00',
      steps: 1,
    });
  });

  it.each(['COMPLETED', 'DEGRADED', 'FAILED'])(
    'does nothing for a run already %s (duplicate delivery)',
    async (status) => {
      repo.findById.mockResolvedValue({ ...base, status });

      await service.run('run-1');

      expect(llm.complete).not.toHaveBeenCalled();
      expect(repo.finish).not.toHaveBeenCalled();
    },
  );

  it("attributes every model call to the run's user, for quotas and spend", async () => {
    repo.findById.mockResolvedValue({ ...base, status: 'QUEUED' });

    await service.run('run-1');

    expect(llm.complete).toHaveBeenCalledWith('agent', expect.anything(), {
      userId: 'u1',
      runId: 'run-1',
    });
  });

  it('markFailed finishes an unfinished run with the fixed answer', async () => {
    repo.findById.mockResolvedValue({ ...base, status: 'RUNNING', steps: 2 });

    await service.markFailed('run-1');

    expect(repo.finish).toHaveBeenCalledWith('run-1', {
      status: 'FAILED',
      answer: FAILED_ANSWER,
      steps: 2,
    });
  });

  it('markFailed never overwrites a finished run', async () => {
    repo.findById.mockResolvedValue({ ...base, status: 'COMPLETED' });

    await service.markFailed('run-1');

    expect(repo.finish).not.toHaveBeenCalled();
  });
});
