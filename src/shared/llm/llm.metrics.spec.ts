import { type Counter, type Meter, metrics } from '@opentelemetry/api';
import { mock, type MockProxy } from 'jest-mock-extended';
import { usage as usageOf } from '../../../test/helpers/llm';
import { LlmMetrics } from './llm.metrics';
import { must } from '../../../test/helpers/must';

describe('LlmMetrics', () => {
  const counters: Record<string, MockProxy<Counter>> = {};

  beforeEach(() => {
    const meter = mock<Meter>();
    meter.createCounter.mockImplementation((name) => {
      counters[name] = mock<Counter>();
      return counters[name];
    });
    jest.spyOn(metrics, 'getMeter').mockReturnValue(meter);
  });

  afterEach(() => jest.restoreAllMocks());

  const counter = (name: string) => must(counters[name], `counter ${name}`);

  const usage = usageOf({ cache_read_input_tokens: 0 });

  it('adds tokens per non-zero direction, cost and the request outcome', () => {
    new LlmMetrics().record('claude-haiku-5-5', 'categorization', usage, 'ok');

    const labels = { model: 'claude-haiku-5-5', feature: 'categorization' };
    expect(counter('fincheck_llm_tokens').add.mock.calls).toEqual([
      [300, { ...labels, direction: 'input' }],
      [50, { ...labels, direction: 'output' }],
    ]);
    expect(counter('fincheck_llm_cost_usd').add).toHaveBeenCalledWith(
      expect.closeTo(0.000055, 9),
      labels,
    );
    expect(counter('fincheck_llm_requests').add).toHaveBeenCalledWith(1, {
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

    expect(counter('fincheck_llm_tokens').add).not.toHaveBeenCalled();
    expect(counter('fincheck_llm_cost_usd').add).not.toHaveBeenCalled();
    expect(counter('fincheck_llm_requests').add).toHaveBeenCalledWith(1, {
      model: 'claude-haiku-5-5',
      feature: 'categorization',
      outcome: 'error',
    });
  });
});
