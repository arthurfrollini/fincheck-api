import Anthropic from '@anthropic-ai/sdk';
import { PinoLogger } from 'nestjs-pino';
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

function response(
  overrides: Partial<{
    stop_reason: Anthropic.StopReason;
    parsed_output: unknown;
    usage: Anthropic.Usage;
  }> = {},
) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    parsed_output: { ok: true },
    usage: usage(),
    ...overrides,
  };
}

const USER_TEXT = 'SECRET TRANSACTION NAME';
const PARAMS = {
  model: 'claude-haiku-5-5' as const,
  max_tokens: 1024,
  messages: [{ role: 'user' as const, content: USER_TEXT }],
};

describe('LlmService', () => {
  let parse: jest.Mock;
  let metrics: jest.Mocked<Pick<LlmMetrics, 'record'>>;
  let logger: jest.Mocked<Pick<PinoLogger, 'info' | 'warn'>>;
  let service: LlmService;

  beforeEach(() => {
    parse = jest.fn().mockResolvedValue(response());
    metrics = { record: jest.fn() };
    logger = { info: jest.fn(), warn: jest.fn() };
    service = new LlmService(
      { messages: { parse } } as unknown as Anthropic,
      metrics as unknown as LlmMetrics,
      logger as unknown as PinoLogger,
    );
  });

  it('records usage and outcome ok on end_turn', async () => {
    await service.parse('categorization', PARAMS, { transactionId: 'tx-1' });

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
    ['refusal', 'refusal'],
    ['max_tokens', 'max_tokens'],
  ] as const)(
    'records outcome %s and still returns the response',
    async (stopReason, outcome) => {
      parse.mockResolvedValueOnce(
        response({ stop_reason: stopReason, parsed_output: null }),
      );

      const result = await service.parse('categorization', PARAMS);

      expect(result.stop_reason).toBe(stopReason);
      expect(metrics.record).toHaveBeenCalledWith(
        'claude-haiku-5-5',
        'categorization',
        usage(),
        outcome,
      );
    },
  );

  it('records outcome unparsed when parsed_output is null on end_turn', async () => {
    parse.mockResolvedValueOnce(response({ parsed_output: null }));

    await service.parse('categorization', PARAMS);

    expect(metrics.record).toHaveBeenCalledWith(
      'claude-haiku-5-5',
      'categorization',
      usage(),
      'unparsed',
    );
  });

  it('rethrows SDK errors and records outcome error with null usage', async () => {
    const error = new Anthropic.RateLimitError(
      429,
      undefined,
      'rate limited',
      new Headers(),
    );
    parse.mockRejectedValueOnce(error);

    await expect(service.parse('categorization', PARAMS)).rejects.toBe(error);
    expect(metrics.record).toHaveBeenCalledWith(
      'claude-haiku-5-5',
      'categorization',
      null,
      'error',
    );
  });

  it('warns when input_tokens exceeds 100_000 on claude-haiku-5-5', async () => {
    parse.mockResolvedValueOnce(
      response({ usage: usage({ input_tokens: 100_001 }) }),
    );

    await service.parse('categorization', PARAMS);

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('never logs message content', async () => {
    await service.parse('categorization', PARAMS);

    const logged = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
    ]);
    expect(logged).not.toContain(USER_TEXT);
  });
});
