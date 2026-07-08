import {
  type TransactionCreate,
  type TransactionEntity,
  type TransactionFilters,
  type TransactionUpdate,
} from '../../entities/Transaction';

export abstract class TransactionsRepository {
  abstract create(data: TransactionCreate): Promise<TransactionEntity>;
  abstract findMany(
    userId: string,
    filters: TransactionFilters,
  ): Promise<{ data: TransactionEntity[]; total: number }>;
  abstract findFirst(
    id: string,
    userId: string,
  ): Promise<TransactionEntity | null>;
  abstract update(
    id: string,
    data: TransactionUpdate,
  ): Promise<TransactionEntity>;
  abstract delete(id: string): Promise<void>;
}
