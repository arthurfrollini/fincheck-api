import { TransactionsPrismaRepository } from './transactions.prisma.repository';
import { PrismaService } from '@shared/database/prisma.service';

describe('TransactionsPrismaRepository', () => {
  let mockPrisma: { transaction: { updateMany: jest.Mock } };
  let repository: TransactionsPrismaRepository;

  beforeEach(() => {
    mockPrisma = {
      transaction: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    repository = new TransactionsPrismaRepository(
      mockPrisma as unknown as PrismaService,
    );
  });

  describe('setCategoryIfUnset', () => {
    it('only writes when the transaction is still uncategorized', async () => {
      await repository.setCategoryIfUnset('tx-1', 'user-1', 'cat-1');

      expect(mockPrisma.transaction.updateMany).toHaveBeenCalledWith({
        where: { id: 'tx-1', userId: 'user-1', categoryId: null },
        data: { categoryId: 'cat-1' },
      });
    });

    it('returns true when a row changed', async () => {
      await expect(
        repository.setCategoryIfUnset('tx-1', 'user-1', 'cat-1'),
      ).resolves.toBe(true);
    });

    it('returns false when no row changed', async () => {
      mockPrisma.transaction.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        repository.setCategoryIfUnset('tx-1', 'user-1', 'cat-1'),
      ).resolves.toBe(false);
    });
  });
});

describe('TransactionsPrismaRepository read queries for the agent', () => {
  let prisma: {
    transaction: {
      findMany: jest.Mock;
      count: jest.Mock;
      aggregate: jest.Mock;
      groupBy: jest.Mock;
    };
    category: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let repository: TransactionsPrismaRepository;
  const from = new Date('2026-09-01T00:00:00.000Z');
  const to = new Date('2026-09-30T00:00:00.000Z');
  const endOfTo = new Date('2026-09-30T23:59:59.999Z');

  beforeEach(() => {
    prisma = {
      transaction: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { value: 150.5 }, _count: { _all: 3 } }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      category: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    repository = new TransactionsPrismaRepository(
      prisma as unknown as PrismaService,
    );
  });

  it('search scopes by user first, includes the whole last day, orders and limits', async () => {
    prisma.transaction.findMany.mockResolvedValueOnce([
      {
        id: 't1',
        name: 'Assaí',
        value: 50,
        date: from,
        type: 'EXPENSE',
        categoryId: 'c1',
        category: { name: 'Mercado' },
      },
    ]);
    prisma.transaction.count.mockResolvedValueOnce(7);

    const result = await repository.search('u1', {
      from,
      to,
      type: 'EXPENSE',
      categoryId: 'c1',
      minValue: 10,
      limit: 5,
      orderBy: 'value',
    });

    const args = prisma.transaction.findMany.mock.calls[0][0];
    expect(Object.keys(args.where)[0]).toBe('userId');
    expect(args.where).toEqual(
      expect.objectContaining({
        userId: 'u1',
        type: 'EXPENSE',
        categoryId: 'c1',
        date: { gte: from, lte: endOfTo },
        value: { gte: 10, lte: undefined },
      }),
    );
    expect(args.orderBy).toEqual({ value: 'desc' });
    expect(args.take).toBe(5);
    expect(result).toEqual({
      data: [expect.objectContaining({ id: 't1', categoryName: 'Mercado' })],
      total: 7,
    });
  });

  it('totals without grouping sums the filtered transactions', async () => {
    await expect(
      repository.totals('u1', { from, to }, 'none'),
    ).resolves.toEqual([
      { key: 'all', label: 'Total', total: 150.5, count: 3 },
    ]);
    expect(prisma.transaction.aggregate.mock.calls[0][0].where.userId).toBe(
      'u1',
    );
  });

  it('totals by category labels each group with the category name, or Sem categoria', async () => {
    prisma.transaction.groupBy.mockResolvedValueOnce([
      { categoryId: 'c1', _sum: { value: 100.111 }, _count: { _all: 2 } },
      { categoryId: null, _sum: { value: 20 }, _count: { _all: 1 } },
    ]);
    prisma.category.findMany.mockResolvedValueOnce([
      { id: 'c1', name: 'Mercado' },
    ]);

    await expect(
      repository.totals('u1', { from, to }, 'category'),
    ).resolves.toEqual([
      { key: 'c1', label: 'Mercado', total: 100.11, count: 2 },
      { key: 'none', label: 'Sem categoria', total: 20, count: 1 },
    ]);
    expect(prisma.category.findMany.mock.calls[0][0].where).toEqual({
      userId: 'u1',
      id: { in: ['c1'] },
    });
  });

  it('totals by month buckets into YYYY-MM in ascending order', async () => {
    prisma.transaction.findMany.mockResolvedValueOnce([
      { date: new Date('2026-09-02T12:00:00Z'), value: 10 },
      { date: new Date('2026-08-31T12:00:00Z'), value: 5 },
      { date: new Date('2026-09-20T12:00:00Z'), value: 2.5 },
    ]);

    await expect(
      repository.totals('u1', { from, to }, 'month'),
    ).resolves.toEqual([
      { key: '2026-08', label: '2026-08', total: 5, count: 1 },
      { key: '2026-09', label: '2026-09', total: 12.5, count: 2 },
    ]);
  });
});
