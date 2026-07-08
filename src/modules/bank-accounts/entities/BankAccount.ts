import { type TransactionType } from '@modules/transactions/entities/Transaction';

export const BankAccountType = {
  CHECKING: 'CHECKING',
  INVESTMENT: 'INVESTMENT',
  CASH: 'CASH',
} as const;

export type BankAccountType =
  (typeof BankAccountType)[keyof typeof BankAccountType];

export interface BankAccountEntity {
  id: string;
  userId: string;
  name: string;
  color: string;
  initialBalance: number;
  type: BankAccountType;
}

export interface BankAccountCreate {
  userId: string;
  name: string;
  color: string;
  initialBalance: number;
  type: BankAccountType;
}

export interface BankAccountUpdate {
  name?: string;
  color?: string;
  initialBalance?: number;
  type?: BankAccountType;
}

export interface BankAccountWithTransactions extends BankAccountEntity {
  transactions: { type: TransactionType; value: number }[];
}
