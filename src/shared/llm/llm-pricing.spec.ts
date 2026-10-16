import type Anthropic from '@anthropic-ai/sdk';
import { computeCostUsd } from './llm-pricing';

function usage(fields: Partial<Anthropic.Usage>): Anthropic.Usage {
  return {
    cache_creation: null,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    inference_geo: null,
    input_tokens: 0,
    output_tokens: 0,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: null,
    speed: null,
    ...fields,
  };
}

describe('computeCostUsd', () => {
  it('prices haiku 5.5 input and output', () => {
    expect(
      computeCostUsd(
        'claude-haiku-5-5',
        usage({ input_tokens: 1_000_000, output_tokens: 1_000_000 }),
      ),
    ).toBeCloseTo(0.6);
  });

  it('prices opus 5.5 input and output', () => {
    expect(
      computeCostUsd(
        'claude-opus-5-5',
        usage({ input_tokens: 1_000_000, output_tokens: 1_000_000 }),
      ),
    ).toBeCloseTo(24);
  });

  it('prices cache reads and writes separately', () => {
    expect(
      computeCostUsd(
        'claude-haiku-5-5',
        usage({
          cache_read_input_tokens: 1_000_000,
          cache_creation_input_tokens: 1_000_000,
        }),
      ),
    ).toBeCloseTo(0.135);
  });

  it('treats null cache fields as zero', () => {
    expect(
      computeCostUsd(
        'claude-haiku-5-5',
        usage({ input_tokens: 300, output_tokens: 50 }),
      ),
    ).toBeCloseTo(0.000055, 9);
  });
});
