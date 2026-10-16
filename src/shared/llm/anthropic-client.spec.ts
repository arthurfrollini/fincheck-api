import { createAnthropicClient } from './anthropic-client';

describe('createAnthropicClient', () => {
  it('disables SDK retries and caps request time', () => {
    const client = createAnthropicClient('sk-test');

    expect(client.maxRetries).toBe(0);
    expect(client.timeout).toBe(30_000);
  });
});
