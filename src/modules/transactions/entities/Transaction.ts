export enum TransactionType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
}

export interface TransactionFilters {
  month: number;
  year: number;
  bankAccountId?: string;
  type?: TransactionType;
}
