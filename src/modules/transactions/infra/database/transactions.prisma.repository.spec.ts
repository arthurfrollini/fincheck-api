import type { Prisma } from '@prisma/client';
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended';
import {
  categoryRow,
  transactionRow,
} from '../../../../../test/helpers/prisma-rows';
import { objectContaining } from '../../../../../test/helpers/match';
import { TransactionsPrismaRepository } from './transactions.prisma.repository';
import { PrismaService } from '@shared/database/prisma.service';

describe('TransactionsPrismaRepository', () => {
  let mockPrisma: DeepMockProxy<PrismaService>;
  let repository: TransactionsPrismaRepository;

  beforeEach(() => {
    mockPrisma = mockDeep<PrismaService>();
    mockPrisma.transaction.updateMany.mockResolvedValue({ count: 1 });
    repository = new TransactionsPrismaRepository(mockPrisma);
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
  let prisma: DeepMockProxy<PrismaService>;
  let repository: TransactionsPrismaRepository;
  const from = new Date('2026-09-01T00:00:00.000Z');
  const to = new Date('2026-09-30T00:00:00.000Z');
  const endOfTo = new Date('2026-09-30T23:59:59.999Z');

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    prisma.transaction.findMany.mockResolvedValue([]);
    prisma.category.findMany.mockResolvedValue([]);
    prisma.transaction.aggregate.mockResolvedValue({
      _sum: { value: 150.5 },
      _count: { _all: 3 },
      _avg: undefined,
      _min: undefined,
      _max: undefined,
    });
    repository = new TransactionsPrismaRepository(prisma);
  });

  it('search scopes by user first, includes the whole last day, orders and limits', async () => {
    // search() reads both results through one $transaction call.
    const row = {
      ...transactionRow({ id: 't1', name: 'Assaí', value: 50, date: from }),
      categoryId: 'c1',
      category: { name: 'Mercado' },
    };
    prisma.$transaction.mockResolvedValueOnce([[row], 7]);

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
    expect(Object.keys(args?.where ?? {})[0]).toBe('userId');
    expect(args?.where).toEqual(
      objectContaining<Prisma.TransactionWhereInput>({
        userId: 'u1',
        type: 'EXPENSE',
        categoryId: 'c1',
        date: { gte: from, lte: endOfTo },
        value: { gte: 10, lte: undefined },
      }),
    );
    expect(args?.orderBy).toEqual({ value: 'desc' });
    expect(args?.take).toBe(5);
    expect(result.total).toBe(7);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 't1', categoryName: 'Mercado' });
  });

  it('totals without grouping sums the filtered transactions', async () => {
    await expect(
      repository.totals('u1', { from, to }, 'none'),
    ).resolves.toEqual([
      { key: 'all', label: 'Total', total: 150.5, count: 3 },
    ]);
    expect(prisma.transaction.aggregate.mock.calls[0][0].where).toMatchObject({
      userId: 'u1',
    });
  });

  it('totals by category labels each group with the category name, or Sem categoria', async () => {
    // mockDeep types groupBy() as grouping by every column; the repository
    // groups by categoryId only, which is all it reads back.
    const group = (
      categoryId: string | null,
      value: number,
      count: number,
    ) => ({
      ...transactionRow({ categoryId }),
      _sum: { value },
      _count: { _all: count },
      _avg: undefined,
      _min: undefined,
      _max: undefined,
    });
    prisma.transaction.groupBy.mockResolvedValueOnce([
      group('c1', 100.111, 2),
      group(null, 20, 1),
    ]);
    prisma.category.findMany.mockResolvedValueOnce([
      categoryRow({ id: 'c1', name: 'Mercado' }),
    ]);

    await expect(
      repository.totals('u1', { from, to }, 'category'),
    ).resolves.toEqual([
      { key: 'c1', label: 'Mercado', total: 100.11, count: 2 },
      { key: 'none', label: 'Sem categoria', total: 20, count: 1 },
    ]);
    expect(prisma.category.findMany.mock.calls[0][0]?.where).toEqual({
      userId: 'u1',
      id: { in: ['c1'] },
    });
  });

  it('totals by month buckets into YYYY-MM in ascending order', async () => {
    prisma.transaction.findMany.mockResolvedValueOnce([
      transactionRow({ date: new Date('2026-09-02T12:00:00Z'), value: 10 }),
      transactionRow({ date: new Date('2026-08-31T12:00:00Z'), value: 5 }),
      transactionRow({ date: new Date('2026-09-20T12:00:00Z'), value: 2.5 }),
    ]);

    await expect(
      repository.totals('u1', { from, to }, 'month'),
    ).resolves.toEqual([
      { key: '2026-08', label: '2026-08', total: 5, count: 1 },
      { key: '2026-09', label: '2026-09', total: 12.5, count: 2 },
    ]);
  });
});
