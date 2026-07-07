import { type Prisma, type Transaction } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { TransactionsRepository } from '@modules/transactions/domain/repositories/transactions.repository';
import { PrismaService } from '@shared/database/prisma.service';
import { type TransactionFilters } from '@modules/transactions/entities/Transaction';

@Injectable()
export class TransactionsPrismaRepository implements TransactionsRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create(data: Prisma.TransactionCreateArgs): Promise<Transaction> {
    return this.prismaService.transaction.create(data);
  }

  findMany(
    userId: string,
    filters: TransactionFilters,
  ): Promise<Transaction[]> {
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

  findFirst(
    args: Prisma.TransactionFindFirstArgs,
  ): Promise<Transaction | null> {
    return this.prismaService.transaction.findFirst(args);
  }

  update(args: Prisma.TransactionUpdateArgs): Promise<Transaction> {
    return this.prismaService.transaction.update(args);
  }

  async delete(transactionId: string): Promise<void> {
    await this.prismaService.transaction.delete({
      where: { id: transactionId },
    });
  }
}
