import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import { mock, type MockProxy } from 'jest-mock-extended';
import { PinoLogger } from 'nestjs-pino';
import { LlmService } from '@shared/llm/llm.service';
import { CategoriesRepository } from '@modules/categories/domain/repositories/categories.repository';
import { TransactionsRepository } from '@modules/transactions/domain/repositories/transactions.repository';
import { type AgentRun, type FinishedStatus } from '../entities/AgentRun';
import { AgentRunsRepository } from '../domain/repositories/agent-runs.repository';
import {
  message,
  textBlock,
  toolUseBlock,
  usage,
} from '../../../../test/helpers/llm';
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

const tokens = usage({ input_tokens: 500, output_tokens: 80 });
const thinking: Anthropic.ThinkingBlock = {
  type: 'thinking',
  thinking: '',
  signature: 'sig',
};

function toolCall(...calls: [string, unknown][]): Anthropic.Message {
  return message({
    content: [
      thinking,
      ...calls.map(([name, input], i) =>
        toolUseBlock(`tu-${name}-${i}`, name, input),
      ),
    ],
    stop_reason: 'tool_use',
    usage: tokens,
  });
}
const final = (text: string): Anthropic.Message =>
  message({ content: [thinking, textBlock(text)], usage: tokens });

// The tool_result blocks of a user turn the loop sent back.
function toolResults(
  content: Anthropic.MessageParam['content'],
): Anthropic.ToolResultBlockParam[] {
  if (typeof content === 'string') return [];
  return content.filter(
    (b): b is Anthropic.ToolResultBlockParam => b.type === 'tool_result',
  );
}

const toolFn = () => jest.fn<Promise<unknown>, [unknown]>();

function handlers(overrides: Partial<ToolHandlers> = {}): ToolHandlers {
  return {
    fetch_categories: toolFn().mockResolvedValue([
      { id: 'c1', name: 'Alimentação', type: 'EXPENSE' },
    ]),
    query_transactions: toolFn().mockResolvedValue({
      transactions: [],
      total: 0,
      truncated: false,
    }),
    compute_totals: toolFn().mockResolvedValue({
      groups: [],
      grandTotal: 412.37,
    }),
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
    const llm = mock<LlmService>();
    llm.complete
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(final('Você gastou R$ 412,37.'));

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
    const secondCall = llm.complete.mock.calls[1][1];
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
    const llm = mock<LlmService>();
    llm.complete
      .mockResolvedValueOnce(toolCall(['fetch_categories', {}], totals))
      .mockResolvedValueOnce(final('ok'));

    await runAgentLoop({
      question: 'q',
      llm: llm,
      handlers: handlers(),
      now: NOW,
    });

    const { messages } = llm.complete.mock.calls[1][1];
    // The mock holds the live array, so later turns are appended to it;
    // the round under test is the third message.
    const results = toolResults(messages[2].content);
    expect(messages[2].role).toBe('user');
    expect(results.map((r) => r.tool_use_id)).toEqual([
      'tu-fetch_categories-0',
      'tu-compute_totals-1',
    ]);
  });

  it('degrades after the step limit without a final answer', async () => {
    const llm = mock<LlmService>();
    llm.complete.mockResolvedValue(toolCall(totals));

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
    const llm = mock<LlmService>();
    llm.complete.mockResolvedValue(toolCall(totals));
    const failing = handlers({
      compute_totals: toolFn().mockRejectedValue(new Error('db down')),
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
    const flaky = toolFn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue({ groups: [], grandTotal: 1 });
    const llm = mock<LlmService>();
    llm.complete
      .mockResolvedValueOnce(toolCall(totals))
      .mockResolvedValueOnce(toolCall(totals))
      .mockResolvedValueOnce(final('ok'));

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
    const cut: Anthropic.Message = {
      ...toolCall(totals),
      stop_reason: 'max_tokens',
    };
    const llm = mock<LlmService>();
    llm.complete.mockResolvedValue(cut);
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
    const llm = mock<LlmService>();
    llm.complete.mockResolvedValue(final('ok'));
    await runAgentLoop({
      question: 'q',
      llm: llm,
      handlers: handlers(),
      now: NOW,
    });
    expect(llm.complete.mock.calls[0][1].max_tokens).toBeGreaterThanOrEqual(
      16000,
    );
  });

  it('degrades on refusal', async () => {
    const llm = mock<LlmService>();
    llm.complete.mockResolvedValue(
      message({ content: [], stop_reason: 'refusal', usage: tokens }),
    );

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
    const llm = mock<LlmService>();
    llm.complete.mockRejectedValue(error);

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
    const llm = mock<LlmService>();
    llm.complete.mockResolvedValue(final('ok'));

    await runAgentLoop({
      question: 'quanto gastei com comida?',
      llm: llm,
      handlers: handlers(),
      now: NOW,
    });

    const [feature, params] = llm.complete.mock.calls[0];
    expect(feature).toBe('agent');
    expect(params.model).toBe(AGENT_MODEL);
    expect(params.output_config).toEqual({ effort: 'medium' });
    expect(params.tools?.map((t) => ('name' in t ? t.name : t.type))).toEqual([
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
  const base: Omit<AgentRun, 'status'> = {
    id: 'run-1',
    userId: 'u1',
    idempotencyKey: null,
    question: 'q',
    answer: null,
    steps: 0,
  };
  let repo: MockProxy<AgentRunsRepository>;
  let llm: MockProxy<LlmService>;
  let service: RunAgentService;
  let logger: MockProxy<PinoLogger>;
  let transactions: MockProxy<TransactionsRepository>;

  beforeEach(() => {
    repo = mock<AgentRunsRepository>();
    llm = mock<LlmService>();
    llm.complete.mockResolvedValue(final('R$ 10,00'));
    logger = mock<PinoLogger>();
    transactions = mock<TransactionsRepository>();
    service = new RunAgentService(
      repo,
      transactions,
      mock<CategoriesRepository>(),
      llm,
      logger,
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

  it.each<[string, unknown, string]>([
    [
      'a Prisma error by its code',
      new Prisma.PrismaClientKnownRequestError('x', {
        code: 'P2024',
        clientVersion: '6.19.3',
      }),
      'P2024',
    ],
    ['an Error by its class name', new TypeError('x'), 'TypeError'],
    ['a thrown string as unknown', 'boom', 'unknown'],
    ['a thrown null as unknown', null, 'unknown'],
  ])('logs a failed tool with %s', async (_label, thrown, code) => {
    repo.findById.mockResolvedValue({ ...base, status: 'QUEUED' });
    llm.complete
      .mockResolvedValueOnce(
        toolCall([
          'compute_totals',
          {
            from: '2026-09-01',
            to: '2026-09-30',
            type: 'EXPENSE',
            groupBy: 'none',
          },
        ]),
      )
      .mockResolvedValueOnce(final('ok'));
    transactions.totals.mockRejectedValue(thrown);

    await service.run('run-1');

    expect(logger.warn).toHaveBeenCalledWith(
      { runId: 'run-1', tool: 'compute_totals', code },
      'Agent tool failed',
    );
  });

  it.each<FinishedStatus>(['COMPLETED', 'DEGRADED', 'FAILED'])(
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
