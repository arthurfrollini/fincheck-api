import type {
  AgentRun,
  BankAccount,
  Category,
  Transaction,
  User,
} from '@prisma/client';

// Complete, typed database rows for unit tests that mock Prisma. Override
// only the fields a test is about.

const CREATED_AT = new Date('2026-09-01T00:00:00Z');

export function userRow(fields: Partial<User> = {}): User {
  return {
    id: 'user-1',
    name: 'Test User',
    role: 'USER',
    plan: 'FREE',
    password: null,
    email: 'user@example.com',
    pendingEmail: null,
    emailToken: null,
    emailTokenExpiresAt: null,
    googleId: null,
    avatarUrl: null,
    stripeCustomerId: null,
    stripePriceId: null,
    ...fields,
  };
}

export function bankAccountRow(fields: Partial<BankAccount> = {}): BankAccount {
  return {
    id: 'ba-1',
    userId: 'user-1',
    name: 'Nubank',
    initialBalance: 0,
    type: 'CHECKING',
    color: '#000000',
    createdAt: CREATED_AT,
    ...fields,
  };
}

export function categoryRow(fields: Partial<Category> = {}): Category {
  return {
    id: 'cat-1',
    userId: 'user-1',
    name: 'Alimentação',
    icon: 'food',
    type: 'EXPENSE',
    ...fields,
  };
}

export function transactionRow(fields: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    userId: 'user-1',
    bankAccountId: 'ba-1',
    categoryId: null,
    name: 'Mercado',
    value: 100,
    date: CREATED_AT,
    type: 'EXPENSE',
    createdAt: CREATED_AT,
    ...fields,
  };
}

export function agentRunRow(fields: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    userId: 'user-1',
    idempotencyKey: null,
    question: 'quanto gastei?',
    status: 'QUEUED',
    answer: null,
    steps: 0,
    createdAt: CREATED_AT,
    completedAt: null,
    ...fields,
  };
}
