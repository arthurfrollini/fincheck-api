import type Anthropic from '@anthropic-ai/sdk';

export type LlmModel = 'claude-haiku-5-5' | 'claude-opus-5-5';

interface ModelPricing {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

// USD per million tokens, first-party API. Haiku 5.5 prices are its
// <=100K-token prompt card; LlmService warns when a prompt crosses that.
// Cache writes use the 5-minute TTL rate (1.25x input).
export const LLM_PRICING: Record<LlmModel, ModelPricing> = {
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheWrite: 0.125,
    cacheRead: 0.01,
  },
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
};

const TOKENS_PER_PRICE_UNIT = 1_000_000;

export function computeCostUsd(
  model: LlmModel,
  usage: Anthropic.Usage,
): number {
  const price = LLM_PRICING[model];
  const total =
    usage.input_tokens * price.input +
    usage.output_tokens * price.output +
    (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite +
    (usage.cache_read_input_tokens ?? 0) * price.cacheRead;
  return total / TOKENS_PER_PRICE_UNIT;
}
