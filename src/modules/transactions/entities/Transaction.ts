export const TransactionType = {
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
} as const;

export type TransactionType =
  (typeof TransactionType)[keyof typeof TransactionType];

export interface TransactionFilters {
  month: number;
  year: number;
  bankAccountId?: string;
  type?: TransactionType;
  page?: number;
  limit?: number;
}

export interface TransactionEntity {
  id: string;
  userId: string;
  bankAccountId: string;
  categoryId: string | null;
  name: string;
  value: number;
  date: Date;
  type: TransactionType;
}

export interface TransactionCreate {
  userId: string;
  bankAccountId: string;
  categoryId?: string | null;
  name: string;
  value: number;
  date: Date;
  type: TransactionType;
}

export interface TransactionUpdate {
  bankAccountId?: string;
  categoryId?: string | null;
  name?: string;
  value?: number;
  date?: Date;
  type?: TransactionType;
}

// Read-side filters for the Q&A agent's tools. Dates are inclusive days.
export interface TransactionSearch {
  from: Date;
  to: Date;
  type?: TransactionType;
  categoryId?: string;
  minValue?: number;
  maxValue?: number;
  limit: number;
  orderBy: 'date' | 'value';
}

export type TransactionTotalsFilter = Pick<
  TransactionSearch,
  'from' | 'to' | 'type' | 'categoryId'
>;

export type TotalsGroupBy = 'none' | 'category' | 'month';

export interface TotalsGroup {
  key: string;
  label: string;
  total: number;
  count: number;
}

export type TransactionWithCategory = TransactionEntity & {
  categoryName: string | null;
};
