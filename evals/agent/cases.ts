import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { SEED } from './seed';

const derivation = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum(['INCOME', 'EXPENSE']).optional(),
  // undefined: any category; null: uncategorized only.
  category: z.string().nullable().optional(),
  op: z.enum(['sum', 'max', 'net']),
});

const caseSchema = z.object({
  id: z.string(),
  question: z.string(),
  derivations: z.array(derivation).min(1),
  source: z.enum(['claude', 'owner']),
});

export type AgentCase = z.infer<typeof caseSchema>;

export function loadAgentCases(
  file = path.join(__dirname, 'cases.jsonl'),
): AgentCase[] {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => caseSchema.parse(JSON.parse(l)));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Expected answers are computed from SEED, never typed by hand.
export function expectedValues(c: AgentCase): number[] {
  return c.derivations.map((d) => {
    const rows = SEED.filter(
      (t) =>
        t.date >= d.from &&
        t.date <= d.to &&
        (d.type === undefined || t.type === d.type) &&
        (d.category === undefined || t.category === d.category),
    );
    if (d.op === 'max') return Math.max(...rows.map((t) => t.value));
    if (d.op === 'net') {
      return round2(
        rows.reduce(
          (s, t) => s + (t.type === 'INCOME' ? t.value : -t.value),
          0,
        ),
      );
    }
    return round2(rows.reduce((s, t) => s + t.value, 0));
  });
}
