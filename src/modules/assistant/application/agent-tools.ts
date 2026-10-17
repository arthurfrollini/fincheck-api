import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { type CategoriesRepository } from '@modules/categories/domain/repositories/categories.repository';
import { type TransactionsRepository } from '@modules/transactions/domain/repositories/transactions.repository';

// The tools take no user identifier, by design: the user is fixed by the
// closure in buildToolHandlers, from the authenticated request. A model that
// hallucinates another user's id has no parameter to put it in.

// 366 inclusive days: a full leap year, or "the last 12 months".
const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'dates must be YYYY-MM-DD')
  // Date silently rolls "2026-09-31" over to Oct 1; a round trip catches it.
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'not a real calendar date')
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

const range = {
  from: isoDate,
  to: isoDate,
  type: z.enum(['INCOME', 'EXPENSE']).optional(),
  // Category ids are UUIDs; a category *name* here would reach Postgres as
  // an invalid uuid and look like an outage instead of a bad input.
  categoryId: z.uuid().optional(),
};

// zod 4 still runs object-level refinements when a field already failed
// (e.g. an impossible date left as a raw string), so these only judge real
// dates and let the field's own issue speak.
const bothDates = (v: { from: unknown; to: unknown }) =>
  v.from instanceof Date && v.to instanceof Date;

function withinRange<T extends { from: Date; to: Date }>(schema: z.ZodType<T>) {
  return schema
    .refine(
      (v) => !bothDates(v) || v.from <= v.to,
      '"from" must not be after "to"',
    )
    .refine(
      (v) =>
        !bothDates(v) ||
        (v.to.getTime() - v.from.getTime()) / DAY_MS + 1 <= MAX_RANGE_DAYS,
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

// type is required for totals: summing income and expenses together gives a
// number that means nothing ("quanto sobrou" is income total minus expense
// total, two calls).
const totalsInput = withinRange(
  z.object({
    ...range,
    type: z.enum(['INCOME', 'EXPENSE']),
    groupBy: z.enum(['none', 'category', 'month']),
  }),
);

const dateProp = (what: string) => ({
  type: 'string',
  format: 'date',
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
    format: 'uuid',
    description: 'A category id from fetch_categories (not its name)',
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
      "Sum the user's income or expenses (type is required) in a date range (max 366 days), optionally grouped by category or by month. Always use this for totals instead of adding numbers yourself; for a balance, call it once per type.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        ...rangeProps,
        groupBy: { type: 'string', enum: ['none', 'category', 'month'] },
      },
      required: ['from', 'to', 'type', 'groupBy'],
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
function isToolName(handlers: ToolHandlers, name: string): name is ToolName {
  return Object.hasOwn(handlers, name);
}

export async function runTool(
  handlers: ToolHandlers,
  block: Anthropic.ToolUseBlock,
  // Reports internal failures (never the input, which is user data).
  onError?: (tool: string, err: unknown) => void,
): Promise<Anthropic.ToolResultBlockParam> {
  const { name } = block;
  // Own keys only: names like 'toString' exist on every object's prototype.
  if (!isToolName(handlers, name)) {
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      is_error: true,
      content: `Unknown tool ${block.name}.`,
    };
  }
  try {
    const result = await handlers[name](block.input);
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      content: JSON.stringify(result),
    };
  } catch (err) {
    if (!(err instanceof z.ZodError)) onError?.(block.name, err);
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
