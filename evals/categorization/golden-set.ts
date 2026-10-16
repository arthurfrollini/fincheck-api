import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { DEFAULT_CATEGORIES } from '@modules/categories/entities/default-categories';

export const NONE_LABEL = 'none';

export const CATEGORY_NAMES_BY_TYPE: Record<'INCOME' | 'EXPENSE', string[]> = {
  INCOME: DEFAULT_CATEGORIES.filter((c) => c.type === 'INCOME').map(
    (c) => c.name,
  ),
  EXPENSE: DEFAULT_CATEGORIES.filter((c) => c.type === 'EXPENSE').map(
    (c) => c.name,
  ),
};

const goldenCaseSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(['INCOME', 'EXPENSE']),
    value: z.number().positive(),
    expected: z.string(),
    source: z.enum(['real', 'synthetic']),
    note: z.string().optional(),
  })
  .refine(
    (c) =>
      c.expected === NONE_LABEL ||
      CATEGORY_NAMES_BY_TYPE[c.type].includes(c.expected),
    {
      message:
        'expected must be a default category name of the same type, or "none"',
    },
  );

export type GoldenCase = z.infer<typeof goldenCaseSchema>;

const DEFAULT_PATH = path.join(__dirname, 'golden-set.jsonl');

export function loadGoldenSet(file = DEFAULT_PATH): GoldenCase[] {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => line.trim() !== '')
    .map(({ line, number }) => {
      const result = goldenCaseSchema.safeParse(JSON.parse(line));
      if (!result.success) {
        throw new Error(
          `${path.basename(file)} line ${number}: ${result.error.message}`,
        );
      }
      return result.data;
    });
}
