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
  abstract search(
    userId: string,
    filters: TransactionSearch,
  ): Promise<{ data: TransactionWithCategory[]; total: number }>;
  abstract totals(
    userId: string,
    filters: TransactionTotalsFilter,
    groupBy: TotalsGroupBy,
  ): Promise<TotalsGroup[]>;
  abstract setCategoryIfUnset(
    id: string,
    userId: string,
    categoryId: string,
  ): Promise<boolean>;
}
