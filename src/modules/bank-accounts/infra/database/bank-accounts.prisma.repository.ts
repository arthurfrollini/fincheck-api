import { type BankAccount, type Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { BankAccountsRepository } from '@modules/bank-accounts/domain/repositories/bank-accounts.repository';
import { PrismaService } from '@shared/database/prisma.service';

@Injectable()
export class BankAccountsPrismaRepository implements BankAccountsRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create(data: Prisma.BankAccountCreateArgs): Promise<BankAccount> {
    return this.prismaService.bankAccount.create(data);
  }

  findMany<T extends Prisma.BankAccountFindManyArgs>(
    findManyDto: Prisma.SelectSubset<T, Prisma.BankAccountFindManyArgs>,
  ) {
    return this.prismaService.bankAccount.findMany(findManyDto);
  }

  findFirst(
    args: Prisma.BankAccountFindFirstArgs,
  ): Promise<BankAccount | null> {
    return this.prismaService.bankAccount.findFirst(args);
  }

  update(
    bankAccountId: string,
    data: Prisma.BankAccountUpdateInput,
  ): Promise<BankAccount> {
    return this.prismaService.bankAccount.update({
      where: { id: bankAccountId },
      data,
    });
  }

  async delete(bankAccountId: string): Promise<void> {
    await this.prismaService.bankAccount.delete({
      where: { id: bankAccountId },
    });
  }
}
