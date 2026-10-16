jest.mock('@shared/config/env', () => ({
  env: { redisHost: 'localhost', redisPort: '6379' },
}));

import { bullRootOptions } from './bullmq';

describe('bullRootOptions', () => {
  const original = process.env.BULLMQ_PREFIX;
  afterEach(() => {
    if (original === undefined) delete process.env.BULLMQ_PREFIX;
    else process.env.BULLMQ_PREFIX = original;
  });

  it("uses BullMQ's default prefix when none is configured", () => {
    delete process.env.BULLMQ_PREFIX;
    expect(bullRootOptions()).toEqual({
      connection: { host: 'localhost', port: 6379 },
      prefix: 'bull',
    });
  });

  it('uses BULLMQ_PREFIX so tests never share queues with a running dev API', () => {
    process.env.BULLMQ_PREFIX = 'bull-test';
    expect(bullRootOptions().prefix).toBe('bull-test');
  });
});
