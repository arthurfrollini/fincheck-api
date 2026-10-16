import Anthropic from '@anthropic-ai/sdk';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { LlmService } from './llm.service';
import { LlmMetrics } from './llm.metrics';

function usage(fields: Partial<Anthropic.Usage> = {}): Anthropic.Usage {
  return {
    cache_creation: null,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    inference_geo: null,
    input_tokens: 300,
    output_tokens: 50,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: null,
    speed: null,
    ...fields,
  };
}

function message(
  text: string | null,
  overrides: Partial<{
    stop_reason: Anthropic.StopReason;
    usage: Anthropic.Usage;
  }> = {},
) {
  const content: unknown[] = [
    { type: 'thinking', thinking: '', signature: 'sig' },
  ];
  if (text !== null) content.push({ type: 'text', text, citations: null });
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content,
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: usage(),
    ...overrides,
  };
}

const SCHEMA = z.object({ answer: z.enum(['a', 'b']) });
const USER_TEXT = 'SECRET TRANSACTION NAME';
const PARAMS = {
  model: 'claude-haiku-5-5' as const,
  max_tokens: 1024,
  messages: [{ role: 'user' as const, content: USER_TEXT }],
};

describe('LlmService', () => {
  let create: jest.Mock;
  let metrics: jest.Mocked<Pick<LlmMetrics, 'record'>>;
  let logger: jest.Mocked<Pick<PinoLogger, 'info' | 'warn'>>;
  let service: LlmService;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue(message('{"answer":"a"}'));
    metrics = { record: jest.fn() };
    logger = { info: jest.fn(), warn: jest.fn() };
    service = new LlmService(
      { messages: { create } } as unknown as Anthropic,
      metrics as unknown as LlmMetrics,
      logger as unknown as PinoLogger,
    );
  });

  it('parses the text block after a leading thinking block and records outcome ok', async () => {
    const result = await service.parse('categorization', PARAMS, SCHEMA, {
      transactionId: 'tx-1',
    });

    expect(result.parsed_output).toEqual({ answer: 'a' });
    expect(create).toHaveBeenCalledWith(PARAMS);
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
      create.mockResolvedValueOnce(message(text));

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
      create.mockResolvedValueOnce(
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
    create.mockRejectedValueOnce(error);

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
    create.mockResolvedValueOnce(
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
