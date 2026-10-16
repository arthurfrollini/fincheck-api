import Anthropic from '@anthropic-ai/sdk';

// BullMQ owns retries for every LLM call path; SDK retries on top would
// multiply attempts. The SDK's 10-minute default timeout would let one hung
// request hold the categorization worker for that long.
const REQUEST_TIMEOUT_MS = 30_000;

export function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    maxRetries: 0,
    timeout: REQUEST_TIMEOUT_MS,
  });
}
