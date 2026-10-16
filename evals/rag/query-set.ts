import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { normalize } from './retrieval';

const querySchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  evidence: z.array(z.string().min(1)),
  inScope: z.boolean(),
  source: z.enum(['claude', 'owner']),
});

export type RagQuery = z.infer<typeof querySchema>;

const DEFAULT_PATH = path.join(__dirname, 'queries.jsonl');

export function loadQuerySet(file = DEFAULT_PATH): RagQuery[] {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, i) => {
      const result = querySchema.safeParse(JSON.parse(line));
      if (!result.success) {
        throw new Error(
          `${path.basename(file)} line ${i + 1}: ${result.error.message}`,
        );
      }
      return result.data;
    });
}

// A snippet that occurs in no chunk can never be retrieved: it would lower
// recall silently instead of flagging a broken label.
export function validateQuerySet(
  queries: RagQuery[],
  chunkTexts: string[],
): void {
  const corpus = chunkTexts.map(normalize);
  const missing = queries.flatMap((q) =>
    q.evidence
      .filter((snippet) => !corpus.some((c) => c.includes(normalize(snippet))))
      .map((snippet) => `${q.id}: "${snippet}"`),
  );
  if (missing.length > 0) {
    throw new Error(`Evidence not found in any chunk:\n${missing.join('\n')}`);
  }
}
