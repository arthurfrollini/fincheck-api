import { UnrecoverableError } from 'bullmq';
import { type z } from 'zod';

// Job data comes back from Redis untyped. A payload that doesn't match its
// schema will never succeed, so the job fails without retrying. ZodError
// messages name paths and expected types, not the values.
export function parseJobData<S extends z.ZodType>(
  schema: S,
  data: unknown,
): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new UnrecoverableError(`Invalid job data: ${result.error.message}`);
  }
  return result.data;
}
