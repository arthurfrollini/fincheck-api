import { UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import { parseJobData } from './job-data';

describe('parseJobData', () => {
  const schema = z.object({ runId: z.string() });

  it('returns the typed data when it matches the schema', () => {
    expect(parseJobData(schema, { runId: 'run-1' })).toEqual({
      runId: 'run-1',
    });
  });

  it('fails without retrying when the data does not match, since a retry cannot fix it', () => {
    expect(() => parseJobData(schema, { runId: 42 })).toThrow(
      UnrecoverableError,
    );
  });
});
