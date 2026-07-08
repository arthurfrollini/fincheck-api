import { type Plan } from '@modules/users/entities/User';

export const PLAN_LIMITS: Record<
  Plan,
  { bankAccounts: number; transactionsPerDay: number; canManageCategories: boolean }
> = {
  FREE: { bankAccounts: 3, transactionsPerDay: 50, canManageCategories: false },
  GOLD: { bankAccounts: 5, transactionsPerDay: 200, canManageCategories: true },
  PLATINUM: {
    bankAccounts: Infinity,
    transactionsPerDay: Infinity,
    canManageCategories: true,
  },
};
