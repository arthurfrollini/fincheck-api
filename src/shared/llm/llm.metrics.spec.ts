import type Anthropic from '@anthropic-ai/sdk';
import { metrics } from '@opentelemetry/api';
import { LlmMetrics } from './llm.metrics';

describe('LlmMetrics', () => {
  const counters: Record<string, { add: jest.Mock }> = {};

  beforeEach(() => {
    jest.spyOn(metrics, 'getMeter').mockReturnValue({
      createCounter: (name: string) => {
        counters[name] = { add: jest.fn() };
        return counters[name];
      },
    } as unknown as ReturnType<typeof metrics.getMeter>);
  });

  afterEach(() => jest.restoreAllMocks());

  const usage = {
    input_tokens: 300,
    output_tokens: 50,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: null,
  } as Anthropic.Usage;

  it('adds tokens per non-zero direction, cost and the request outcome', () => {
    new LlmMetrics().record('claude-haiku-5-5', 'categorization', usage, 'ok');

    const labels = { model: 'claude-haiku-5-5', feature: 'categorization' };
    expect(counters.fincheck_llm_tokens.add.mock.calls).toEqual([
      [300, { ...labels, direction: 'input' }],
      [50, { ...labels, direction: 'output' }],
    ]);
    expect(counters.fincheck_llm_cost_usd.add).toHaveBeenCalledWith(
      expect.closeTo(0.000055, 9),
      labels,
    );
    expect(counters.fincheck_llm_requests.add).toHaveBeenCalledWith(1, {
      ...labels,
      outcome: 'ok',
    });
  });

  it('counts only the request when usage is null', () => {
    new LlmMetrics().record(
      'claude-haiku-5-5',
      'categorization',
      null,
      'error',
    );

    expect(counters.fincheck_llm_tokens.add).not.toHaveBeenCalled();
    expect(counters.fincheck_llm_cost_usd.add).not.toHaveBeenCalled();
    expect(counters.fincheck_llm_requests.add).toHaveBeenCalledWith(1, {
      model: 'claude-haiku-5-5',
      feature: 'categorization',
      outcome: 'error',
    });
  });
});
