import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';
import { TransactionsRepository } from '@modules/transactions/domain/repositories/transactions.repository';
import {
  type TransactionCreate,
  type TransactionEntity,
  type TransactionFilters,
  type TransactionSearch,
  type TransactionTotalsFilter,
  type TransactionUpdate,
  type TransactionWithCategory,
  type TotalsGroup,
  type TotalsGroupBy,
} from '@modules/transactions/entities/Transaction';

const round2 = (n: number) => Math.round(n * 100) / 100;

const endOfDay = (d: Date) => {
  const end = new Date(d);
  end.setUTCHours(23, 59, 59, 999);
  return end;
};

// userId is always the first condition: every agent read is scoped to the
// authenticated user before any model-supplied filter applies.
function readWhere(userId: string, f: TransactionTotalsFilter) {
  return {
    userId,
    date: { gte: f.from, lte: endOfDay(f.to) },
    type: f.type,
    categoryId: f.categoryId,
  };
}

@Injectable()
export class TransactionsPrismaRepository implements TransactionsRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create(data: TransactionCreate): Promise<TransactionEntity> {
    return this.prismaService.transaction.create({ data });
  }

  async findMany(
    userId: string,
    filters: TransactionFilters,
  ): Promise<{ data: TransactionEntity[]; total: number }> {
    const { month, year, bankAccountId, type, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const where = {
      userId,
      bankAccountId,
      type,
      date: {
        gte: new Date(Date.UTC(year, month - 1)),
        lt: new Date(Date.UTC(year, month)),
      },
    };

    const [data, total] = await this.prismaService.$transaction([
      this.prismaService.transaction.findMany({ where, skip, take: limit }),
      this.prismaService.transaction.count({ where }),
    ]);

    return { data, total };
  }

  findFirst(id: string, userId: string): Promise<TransactionEntity | null> {
    return this.prismaService.transaction.findFirst({ where: { id, userId } });
  }

  update(id: string, data: TransactionUpdate): Promise<TransactionEntity> {
    return this.prismaService.transaction.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prismaService.transaction.delete({ where: { id } });
  }

  // Conditional on categoryId still being null, so a category the user set
  // while a categorization job was in flight is never overwritten.
  async setCategoryIfUnset(
    id: string,
    userId: string,
    categoryId: string,
  ): Promise<boolean> {
    const { count } = await this.prismaService.transaction.updateMany({
      where: { id, userId, categoryId: null },
      data: { categoryId },
    });
    return count > 0;
  }

  async search(
    userId: string,
    f: TransactionSearch,
  ): Promise<{ data: TransactionWithCategory[]; total: number }> {
    const where = {
      ...readWhere(userId, f),
      value: { gte: f.minValue, lte: f.maxValue },
    };
    const [rows, total] = await this.prismaService.$transaction([
      this.prismaService.transaction.findMany({
        where,
        include: { category: { select: { name: true } } },
        orderBy: { [f.orderBy]: 'desc' },
        take: f.limit,
      }),
      this.prismaService.transaction.count({ where }),
    ]);
    return {
      data: rows.map(({ category, ...t }) => ({
        ...t,
        categoryName: category?.name ?? null,
      })),
      total,
    };
  }

  async totals(
    userId: string,
    f: TransactionTotalsFilter,
    groupBy: TotalsGroupBy,
  ): Promise<TotalsGroup[]> {
    const where = readWhere(userId, f);

    if (groupBy === 'none') {
      const agg = await this.prismaService.transaction.aggregate({
        where,
        _sum: { value: true },
        _count: { _all: true },
      });
      return [
        {
          key: 'all',
          label: 'Total',
          total: round2(agg._sum.value ?? 0),
          count: agg._count._all,
        },
      ];
    }

    if (groupBy === 'category') {
      const groups = await this.prismaService.transaction.groupBy({
        by: ['categoryId'],
        where,
        _sum: { value: true },
        _count: { _all: true },
      });
      const ids = groups
        .map((g) => g.categoryId)
        .filter((id): id is string => id !== null);
      const names = new Map(
        (
          await this.prismaService.category.findMany({
            where: { userId, id: { in: ids } },
            select: { id: true, name: true },
          })
        ).map((c) => [c.id, c.name]),
      );
      return groups.map((g) => ({
        key: g.categoryId ?? 'none',
        label: g.categoryId
          ? (names.get(g.categoryId) ?? 'Sem categoria')
          : 'Sem categoria',
        total: round2(g._sum.value ?? 0),
        count: g._count._all,
      }));
    }

    // Month buckets in code: Prisma can't group by a date part, and a user's
    // transactions for at most a year are a small set.
    const rows = await this.prismaService.transaction.findMany({
      where,
      select: { date: true, value: true },
    });
    const buckets = new Map<string, { total: number; count: number }>();
    for (const r of rows) {
      const key = r.date.toISOString().slice(0, 7);
      const b = buckets.get(key) ?? { total: 0, count: 0 };
      b.total += r.value;
      b.count += 1;
      buckets.set(key, b);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, b]) => ({
        key,
        label: key,
        total: round2(b.total),
        count: b.count,
      }));
  }
}
