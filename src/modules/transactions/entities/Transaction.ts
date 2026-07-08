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
