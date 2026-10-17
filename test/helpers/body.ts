import type { Response } from 'supertest';
import { z } from 'zod';

// A response body comes off the wire untyped. Parsing it with a schema gives
// the test a real type and fails loudly when the API's shape changes.
export function parseBody<S extends z.ZodType>(
  res: Response,
  schema: S,
): z.infer<S> {
  return schema.parse(res.body);
}

export const withId = z.object({ id: z.string() });
export const idList = z.array(withId);
export const withRunId = z.object({ runId: z.string() });
export const authTokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
export const categoryList = z.array(
  z.object({ id: z.string(), name: z.string(), type: z.string() }),
);
export const runStatus = z.object({
  status: z.string(),
  answer: z.string().nullable(),
  steps: z.number(),
});
