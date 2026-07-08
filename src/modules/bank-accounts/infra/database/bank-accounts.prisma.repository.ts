import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';
import { BankAccountsRepository } from '@modules/bank-accounts/domain/repositories/bank-accounts.repository';
import {
  type BankAccountCreate,
  type BankAccountEntity,
  type BankAccountUpdate,
  type BankAccountWithTransactions,
} from '@modules/bank-accounts/entities/BankAccount';

@Injectable()
export class BankAccountsPrismaRepository implements BankAccountsRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create(data: BankAccountCreate): Promise<BankAccountEntity> {
    return this.prismaService.bankAccount.create({ data });
  }

  findManyWithTransactions(
    userId: string,
  ): Promise<BankAccountWithTransactions[]> {
    return this.prismaService.bankAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: {
        transactions: {
          select: { type: true, value: true },
        },
      },
    });
  }

  findFirst(id: string, userId: string): Promise<BankAccountEntity | null> {
    return this.prismaService.bankAccount.findFirst({ where: { id, userId } });
  }

  update(id: string, data: BankAccountUpdate): Promise<BankAccountEntity> {
    return this.prismaService.bankAccount.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prismaService.bankAccount.delete({ where: { id } });
  }
}
