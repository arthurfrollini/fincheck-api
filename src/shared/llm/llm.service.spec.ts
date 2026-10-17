import Anthropic from '@anthropic-ai/sdk';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { LlmService } from './llm.service';
import { LlmMetrics } from './llm.metrics';
import { AiUsageRepository } from './ai-usage.repository';
import {
  type DeepMockProxy,
  mock,
  mockDeep,
  type MockProxy,
} from 'jest-mock-extended';
import {
  message as baseMessage,
  textBlock,
  usage,
} from '../../../test/helpers/llm';
import { closeTo } from '../../../test/helpers/match';

// A reply with the leading thinking block adaptive thinking produces.
function message(
  text: string | null,
  fields: Partial<Anthropic.Message> = {},
): Anthropic.Message {
  const content: Anthropic.ContentBlock[] = [
    { type: 'thinking', thinking: '', signature: 'sig' },
  ];
  if (text !== null) content.push(textBlock(text));
  return baseMessage({ content, ...fields });
}

const SCHEMA = z.object({ answer: z.enum(['a', 'b']) });
const USER_TEXT = 'SECRET TRANSACTION NAME';
const PARAMS = {
  model: 'claude-haiku-5-5' as const,
  max_tokens: 1024,
  messages: [{ role: 'user' as const, content: USER_TEXT }],
};

describe('LlmService', () => {
  let anthropic: DeepMockProxy<Anthropic>;
  let metrics: MockProxy<LlmMetrics>;
  let logger: MockProxy<PinoLogger>;
  let service: LlmService;

  beforeEach(() => {
    anthropic = mockDeep<Anthropic>();
    anthropic.messages.create.mockResolvedValue(message('{"answer":"a"}'));
    metrics = mock<LlmMetrics>();
    logger = mock<PinoLogger>();
    service = new LlmService(anthropic, metrics, logger);
  });

  it('parses the text block after a leading thinking block and records outcome ok', async () => {
    const result = await service.parse('categorization', PARAMS, SCHEMA, {
      transactionId: 'tx-1',
    });

    expect(result.parsed_output).toEqual({ answer: 'a' });
    expect(anthropic.messages.create).toHaveBeenCalledWith(PARAMS);
    expect(metrics.record).toHaveBeenCalledWith(
      'claude-haiku-5-5',
      'categorization',
      usage(),
      'ok',
    );
    const [payload] = logger.info.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toEqual(
      expect.objectContaining({
        feature: 'categorization',
        model: 'claude-haiku-5-5',
        input_tokens: 300,
        output_tokens: 50,
        cost_usd: expect.any(Number) as number,
        latency_ms: expect.any(Number) as number,
        stop_reason: 'end_turn',
        transactionId: 'tx-1',
      }),
    );
  });

  it.each([
    ['prose instead of JSON', 'I cannot categorize this.'],
    ['a value outside the schema', '{"answer":"zzz"}'],
    ['no text block', null],
  ])(
    'returns parsed_output null with outcome unparsed for %s, keeping usage',
    async (_label, text) => {
      anthropic.messages.create.mockResolvedValueOnce(message(text));

      const result = await service.parse('categorization', PARAMS, SCHEMA);

      expect(result.parsed_output).toBeNull();
      expect(metrics.record).toHaveBeenCalledWith(
        'claude-haiku-5-5',
        'categorization',
        usage(),
        'unparsed',
      );
    },
  );

  it.each([
    ['refusal', 'refusal'],
    ['max_tokens', 'max_tokens'],
  ] as const)(
    'records outcome %s even when partial text is present, without parsing it',
    async (stopReason, outcome) => {
      anthropic.messages.create.mockResolvedValueOnce(
        message('{"answer":"a"', { stop_reason: stopReason }),
      );

      const result = await service.parse('categorization', PARAMS, SCHEMA);

      expect(result.stop_reason).toBe(stopReason);
      expect(result.parsed_output).toBeNull();
      expect(metrics.record).toHaveBeenCalledWith(
        'claude-haiku-5-5',
        'categorization',
        usage(),
        outcome,
      );
    },
  );

  it('rethrows SDK errors and records outcome error with null usage', async () => {
    const error = new Anthropic.RateLimitError(
      429,
      undefined,
      'rate limited',
      new Headers(),
    );
    anthropic.messages.create.mockRejectedValueOnce(error);

    await expect(service.parse('categorization', PARAMS, SCHEMA)).rejects.toBe(
      error,
    );
    expect(metrics.record).toHaveBeenCalledWith(
      'claude-haiku-5-5',
      'categorization',
      null,
      'error',
    );
  });

  it('warns when input_tokens exceeds 100_000 on claude-haiku-5-5', async () => {
    anthropic.messages.create.mockResolvedValueOnce(
      message('{"answer":"a"}', { usage: usage({ input_tokens: 100_001 }) }),
    );

    await service.parse('categorization', PARAMS, SCHEMA);

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('never logs message content', async () => {
    await service.parse('categorization', PARAMS, SCHEMA);

    const logged = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
    ]);
    expect(logged).not.toContain(USER_TEXT);
  });
});

describe('LlmService.complete', () => {
  let anthropic: DeepMockProxy<Anthropic>;
  let metrics: MockProxy<LlmMetrics>;
  let service: LlmService;
  const params = {
    model: 'claude-sonnet-5-5' as const,
    max_tokens: 4096,
    messages: [{ role: 'user' as const, content: USER_TEXT }],
  };

  beforeEach(() => {
    anthropic = mockDeep<Anthropic>();
    anthropic.messages.create.mockResolvedValue(message('An answer.'));
    metrics = mock<LlmMetrics>();
    service = new LlmService(anthropic, metrics, mock<PinoLogger>());
  });

  it('returns the message and records outcome ok', async () => {
    const result = await service.complete('rag', params);

    expect(result.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: 'An answer.' })]),
    );
    expect(metrics.record).toHaveBeenCalledWith(
      'claude-sonnet-5-5',
      'rag',
      usage(),
      'ok',
    );
  });

  it.each(['refusal', 'max_tokens'] as const)(
    'records outcome %s',
    async (stopReason) => {
      anthropic.messages.create.mockResolvedValueOnce(
        message('x', { stop_reason: stopReason }),
      );

      await service.complete('rag', params);

      expect(metrics.record).toHaveBeenCalledWith(
        'claude-sonnet-5-5',
        'rag',
        usage(),
        stopReason,
      );
    },
  );

  it('rethrows SDK errors recording outcome error', async () => {
    const error = new Anthropic.InternalServerError(
      500,
      undefined,
      'x',
      new Headers(),
    );
    anthropic.messages.create.mockRejectedValueOnce(error);

    await expect(service.complete('rag', params)).rejects.toBe(error);
    expect(metrics.record).toHaveBeenCalledWith(
      'claude-sonnet-5-5',
      'rag',
      null,
      'error',
    );
  });
});

describe('LlmService usage recording', () => {
  let anthropic: DeepMockProxy<Anthropic>;
  let usageRepo: MockProxy<AiUsageRepository>;
  let logger: MockProxy<PinoLogger>;
  const params = {
    model: 'claude-sonnet-5-5' as const,
    max_tokens: 4096,
    messages: [{ role: 'user' as const, content: 'q' }],
  };
  const build = (repo?: AiUsageRepository) =>
    new LlmService(anthropic, mock<LlmMetrics>(), logger, repo);

  beforeEach(() => {
    anthropic = mockDeep<Anthropic>();
    anthropic.messages.create.mockResolvedValue(message('An answer.'));
    usageRepo = mock<AiUsageRepository>();
    usageRepo.record.mockResolvedValue(undefined);
    logger = mock<PinoLogger>();
  });

  it('records tokens and cost for the user when the caller passes userId', async () => {
    await build(usageRepo).complete('rag', params, { userId: 'u1' });

    expect(usageRepo.record).toHaveBeenCalledWith({
      userId: 'u1',
      feature: 'rag',
      model: 'claude-sonnet-5-5',
      inputTokens: 300,
      outputTokens: 50,
      costUsd: closeTo(0.0011, 6),
    });
  });

  it('records nothing without a userId (evals, scripts)', async () => {
    await build(usageRepo).complete('rag', params, {});
    expect(usageRepo.record).not.toHaveBeenCalled();
  });

  it('works without a usage repository at all', async () => {
    await expect(
      build(undefined).complete('rag', params, { userId: 'u1' }),
    ).resolves.toBeDefined();
  });

  it('still returns the answer when recording fails, and logs it', async () => {
    usageRepo.record.mockRejectedValueOnce(new Error('db down'));

    const result = await build(usageRepo).complete('rag', params, {
      userId: 'u1',
    });

    expect(result.content).toBeDefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
