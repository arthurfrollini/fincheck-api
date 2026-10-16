import type Anthropic from '@anthropic-ai/sdk';
import { AGENT_TOOLS, buildToolHandlers, runTool } from './agent-tools';

function deps() {
  return {
    transactions: {
      search: jest.fn().mockResolvedValue({
        data: [
          {
            id: 't1',
            name: 'Assaí',
            value: 50,
            date: new Date('2026-09-05T12:00:00Z'),
            type: 'EXPENSE',
            categoryId: 'c1',
            categoryName: 'Mercado',
            userId: 'u1',
            bankAccountId: 'b1',
          },
        ],
        total: 1,
      }),
      totals: jest
        .fn()
        .mockResolvedValue([
          { key: 'all', label: 'Total', total: 50, count: 1 },
        ]),
    },
    categories: {
      findAllByUserId: jest.fn().mockResolvedValue([
        {
          id: 'c1',
          userId: 'u1',
          name: 'Mercado',
          icon: 'grocery',
          type: 'EXPENSE',
        },
      ]),
    },
  };
}

const use = (name: string, input: unknown): Anthropic.ToolUseBlock =>
  ({
    type: 'tool_use',
    id: `tu-${name}`,
    name,
    input,
  }) as Anthropic.ToolUseBlock;

describe('agent tools', () => {
  it('expose no user identifier in any schema and are strict', () => {
    for (const tool of AGENT_TOOLS) {
      const schema = JSON.stringify(tool.input_schema).toLowerCase();
      expect(schema).not.toContain('user');
      expect(tool.strict).toBe(true);
      expect(tool.input_schema).toEqual(
        expect.objectContaining({ additionalProperties: false }),
      );
    }
    expect(AGENT_TOOLS.map((t) => t.name).sort()).toEqual([
      'compute_totals',
      'fetch_categories',
      'query_transactions',
    ]);
  });

  it('query_transactions reads only the closure user, even if the input names another', async () => {
    const d = deps();
    const handlers = buildToolHandlers('u1', d);

    const result = await runTool(
      handlers,
      use('query_transactions', {
        from: '2026-09-01',
        to: '2026-09-30',
        userId: 'u2',
      }),
    );

    expect(result.is_error).toBeFalsy();
    expect(d.transactions.search).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ limit: 20, orderBy: 'date' }),
    );
    expect(JSON.parse(result.content as string)).toEqual({
      transactions: [
        {
          id: 't1',
          name: 'Assaí',
          value: 50,
          date: '2026-09-05',
          type: 'EXPENSE',
          categoryName: 'Mercado',
        },
      ],
      total: 1,
      truncated: false,
    });
  });

  it('compute_totals passes the closure user and the grouping', async () => {
    const d = deps();
    await runTool(
      buildToolHandlers('u1', d),
      use('compute_totals', {
        from: '2026-09-01',
        to: '2026-09-30',
        groupBy: 'category',
        type: 'EXPENSE',
      }),
    );

    expect(d.transactions.totals).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ type: 'EXPENSE' }),
      'category',
    );
  });

  it('fetch_categories returns id, name and type only', async () => {
    const result = await runTool(
      buildToolHandlers('u1', deps()),
      use('fetch_categories', {}),
    );
    expect(JSON.parse(result.content as string)).toEqual([
      { id: 'c1', name: 'Mercado', type: 'EXPENSE' },
    ]);
  });

  it.each([
    [
      'reversed dates',
      { from: '2026-09-30', to: '2026-09-01', groupBy: 'none' },
    ],
    [
      'range over 366 days',
      { from: '2025-01-01', to: '2026-09-01', groupBy: 'none' },
    ],
    [
      'bad date format',
      { from: '01/09/2026', to: '2026-09-30', groupBy: 'none' },
    ],
    [
      'unknown groupBy',
      { from: '2026-09-01', to: '2026-09-30', groupBy: 'week' },
    ],
  ])(
    'returns an is_error result for %s instead of throwing',
    async (_label, input) => {
      const d = deps();
      const result = await runTool(
        buildToolHandlers('u1', d),
        use('compute_totals', input),
      );

      expect(result.is_error).toBe(true);
      expect(result.tool_use_id).toBe('tu-compute_totals');
      expect(d.transactions.totals).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'an impossible date',
      {
        from: '2026-09-01',
        to: '2026-09-31',
        type: 'EXPENSE',
        groupBy: 'none',
      },
    ],
    [
      'a 367-day range',
      {
        from: '2025-01-01',
        to: '2026-01-02',
        type: 'EXPENSE',
        groupBy: 'none',
      },
    ],
    [
      'a missing type (income and expenses would be summed together)',
      { from: '2026-09-01', to: '2026-09-30', groupBy: 'none' },
    ],
  ])('rejects %s as invalid input', async (_label, input) => {
    const d = deps();
    const result = await runTool(
      buildToolHandlers('u1', d),
      use('compute_totals', input),
    );

    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/^Invalid input/);
    expect(d.transactions.totals).not.toHaveBeenCalled();
  });

  it('accepts a 366-day range', async () => {
    const result = await runTool(
      buildToolHandlers('u1', deps()),
      use('compute_totals', {
        from: '2025-01-01',
        to: '2026-01-01',
        type: 'EXPENSE',
        groupBy: 'none',
      }),
    );
    expect(result.is_error).toBeFalsy();
  });

  it('reports a category name passed as categoryId as invalid input, not as a database outage', async () => {
    const d = deps();
    const result = await runTool(
      buildToolHandlers('u1', d),
      use('query_transactions', {
        from: '2026-09-01',
        to: '2026-09-30',
        categoryId: 'Alimentação',
      }),
    );

    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/^Invalid input.*categoryId/);
    expect(d.transactions.search).not.toHaveBeenCalled();
  });

  it('reports a failed read to the error callback with the tool name, never the input', async () => {
    const d = deps();
    d.transactions.search.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { code: 'P1001' }),
    );
    const onError = jest.fn();

    await runTool(
      buildToolHandlers('u1', d),
      use('query_transactions', { from: '2026-09-01', to: '2026-09-30' }),
      onError,
    );

    expect(onError).toHaveBeenCalledWith(
      'query_transactions',
      expect.any(Error),
    );
  });

  it('turns a repository failure into an is_error result without leaking internals', async () => {
    const d = deps();
    d.transactions.search.mockRejectedValueOnce(
      new Error('connection refused at 10.0.0.3'),
    );

    const result = await runTool(
      buildToolHandlers('u1', d),
      use('query_transactions', { from: '2026-09-01', to: '2026-09-30' }),
    );

    expect(result.is_error).toBe(true);
    expect(result.content).not.toContain('10.0.0.3');
  });

  it('returns is_error for an unknown tool name', async () => {
    const result = await runTool(
      buildToolHandlers('u1', deps()),
      use('delete_everything', {}),
    );
    expect(result.is_error).toBe(true);
  });
});
