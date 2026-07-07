import { type BankAccount, type Prisma } from '@prisma/client';

export abstract class BankAccountsRepository {
  abstract create(
    bankAccountCreateDto: Prisma.BankAccountCreateArgs,
  ): Promise<BankAccount>;
  abstract findMany<T extends Prisma.BankAccountFindManyArgs>(
    findManyDto: Prisma.SelectSubset<T, Prisma.BankAccountFindManyArgs>,
  ): Promise<Prisma.BankAccountGetPayload<T>[]>;
  abstract findFirst(
    args: Prisma.BankAccountFindFirstArgs,
  ): Promise<BankAccount | null>;
  abstract update(
    bankAccountId: string,
    bankAccountUpdateDto: Prisma.BankAccountUpdateInput,
  ): Promise<BankAccount>;
  abstract delete(bankAccountId: string): Promise<void>;
}
