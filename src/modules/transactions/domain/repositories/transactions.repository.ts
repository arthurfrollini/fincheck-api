import { type TransactionFilters } from '@modules/transactions/entities/Transaction';
import { type Transaction, type Prisma } from '@prisma/client';

export abstract class TransactionsRepository {
  abstract create(
    transactionCreateArgs: Prisma.TransactionCreateArgs,
  ): Promise<Transaction>;
  abstract findMany(
    userId: string,
    filters: TransactionFilters,
  ): Promise<Transaction[]>;
  abstract findFirst(
    args: Prisma.TransactionFindFirstArgs,
  ): Promise<Transaction | null>;
  abstract update(
    transactionUpdateArgs: Prisma.TransactionUpdateArgs,
  ): Promise<Transaction>;
  abstract delete(transactionId: string): Promise<void>;
}
