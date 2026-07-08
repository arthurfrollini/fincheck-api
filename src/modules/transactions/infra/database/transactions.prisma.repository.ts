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
}
