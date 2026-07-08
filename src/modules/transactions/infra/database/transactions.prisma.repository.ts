import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';
import { TransactionsRepository } from '@modules/transactions/domain/repositories/transactions.repository';
import {
  type TransactionCreate,
  type TransactionEntity,
  type TransactionFilters,
  type TransactionUpdate,
} from '@modules/transactions/entities/Transaction';

@Injectable()
export class TransactionsPrismaRepository implements TransactionsRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create(data: TransactionCreate): Promise<TransactionEntity> {
    return this.prismaService.transaction.create({ data });
  }

  findMany(
    userId: string,
    filters: TransactionFilters,
  ): Promise<TransactionEntity[]> {
    return this.prismaService.transaction.findMany({
      where: {
        userId,
        bankAccountId: filters.bankAccountId,
        type: filters.type,
        date: {
          gte: new Date(Date.UTC(filters.year, filters.month)),
          lt: new Date(Date.UTC(filters.year, filters.month + 1)),
        },
      },
    });
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
}
