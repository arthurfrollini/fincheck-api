import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { type CategoriesRepository } from '@modules/categories/domain/repositories/categories.repository';
import { type TransactionsRepository } from '@modules/transactions/domain/repositories/transactions.repository';

// The tools take no user identifier, by design: the user is fixed by the
// closure in buildToolHandlers, from the authenticated request. A model that
// hallucinates another user's id has no parameter to put it in.

const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'dates must be YYYY-MM-DD')
  .transform((s) => new Date(`${s}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'invalid date');

const range = {
  from: isoDate,
  to: isoDate,
  type: z.enum(['INCOME', 'EXPENSE']).optional(),
  categoryId: z.string().optional(),
};

function withinRange<T extends { from: Date; to: Date }>(schema: z.ZodType<T>) {
  return schema
    .refine((v) => v.from <= v.to, '"from" must not be after "to"')
    .refine(
      (v) => (v.to.getTime() - v.from.getTime()) / DAY_MS <= MAX_RANGE_DAYS,
      `the date range must be at most ${MAX_RANGE_DAYS} days`,
    );
}

const queryInput = withinRange(
  z.object({
    ...range,
    minValue: z.number().nonnegative().optional(),
    maxValue: z.number().nonnegative().optional(),
    limit: z.number().int().min(1).max(50).default(20),
    orderBy: z.enum(['date', 'value']).default('date'),
  }),
);

const totalsInput = withinRange(
  z.object({ ...range, groupBy: z.enum(['none', 'category', 'month']) }),
);

const dateProp = (what: string) => ({
  type: 'string',
  description: `${what} date, inclusive, YYYY-MM-DD`,
});
const rangeProps = {
  from: dateProp('Start'),
  to: dateProp('End'),
  type: {
    type: 'string',
    enum: ['INCOME', 'EXPENSE'],
    description: 'Only income or only expenses',
  },
  categoryId: {
    type: 'string',
    description: 'A category id from fetch_categories',
  },
};

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'fetch_categories',
    description:
      "List the user's transaction categories (id, name, INCOME or EXPENSE). Use it to turn a category name the user mentions into a categoryId.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'query_transactions',
    description:
      'List the user\'s individual transactions in a date range (max 366 days), newest or largest first. Use for "which", "biggest", "last" questions; use compute_totals for sums.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        ...rangeProps,
        minValue: { type: 'number', description: 'Minimum value in BRL' },
        maxValue: { type: 'number', description: 'Maximum value in BRL' },
        limit: { type: 'integer', description: '1 to 50, default 20' },
        orderBy: {
          type: 'string',
          enum: ['date', 'value'],
          description: 'Sort descending by date (default) or by value',
        },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: 'compute_totals',
    description:
      "Sum the user's transactions in a date range (max 366 days), optionally grouped by category or by month. Always use this for totals instead of adding numbers yourself.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        ...rangeProps,
        groupBy: { type: 'string', enum: ['none', 'category', 'month'] },
      },
      required: ['from', 'to', 'groupBy'],
      additionalProperties: false,
    },
  },
];

export type ToolName =
  'fetch_categories' | 'query_transactions' | 'compute_totals';
export type ToolHandlers = Record<
  ToolName,
  (input: unknown) => Promise<unknown>
>;

export function buildToolHandlers(
  userId: string,
  deps: {
    transactions: Pick<TransactionsRepository, 'search' | 'totals'>;
    categories: Pick<CategoriesRepository, 'findAllByUserId'>;
  },
): ToolHandlers {
  return {
    fetch_categories: async () =>
      (await deps.categories.findAllByUserId(userId)).map(
        ({ id, name, type }) => ({
          id,
          name,
          type,
        }),
      ),

    query_transactions: async (input) => {
      const f = queryInput.parse(input);
      const { data, total } = await deps.transactions.search(userId, f);
      return {
        transactions: data.map((t) => ({
          id: t.id,
          name: t.name,
          value: t.value,
          date: t.date.toISOString().slice(0, 10),
          type: t.type,
          categoryName: t.categoryName,
        })),
        total,
        truncated: total > data.length,
      };
    },

    compute_totals: async (input) => {
      const { groupBy, ...f } = totalsInput.parse(input);
      const groups = await deps.transactions.totals(userId, f, groupBy);
      return {
        groups,
        grandTotal:
          Math.round(groups.reduce((s, g) => s + g.total, 0) * 100) / 100,
      };
    },
  };
}

// Never throws: a failed or invalid call becomes an is_error tool_result, so
// the conversation stays well-formed and the model can correct its input.
export async function runTool(
  handlers: ToolHandlers,
  block: Anthropic.ToolUseBlock,
): Promise<Anthropic.ToolResultBlockParam> {
  const handler = handlers[block.name as ToolName];
  if (!handler) {
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      is_error: true,
      content: `Unknown tool ${block.name}.`,
    };
  }
  try {
    const result = await handler(block.input);
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      content: JSON.stringify(result),
    };
  } catch (err) {
    const content =
      err instanceof z.ZodError
        ? `Invalid input: ${err.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`
        : // Internal errors are not echoed to the model: they can carry
          // hostnames or SQL. It only needs to know the read failed.
          'The data could not be read right now.';
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      is_error: true,
      content,
    };
  }
}
