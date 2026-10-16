import { type Plan } from '@modules/users/entities/User';

export const PLAN_LIMITS: Record<
  Plan,
  {
    bankAccounts: number;
    transactionsPerDay: number;
    canManageCategories: boolean;
    // Questions to the RAG and the agent per UTC day. FREE gets none: the
    // only way to spend Claude credit at scale would be mass free signups.
    ragQuestionsPerDay: number;
    agentQuestionsPerDay: number;
  }
> = {
  FREE: {
    bankAccounts: 3,
    transactionsPerDay: 50,
    canManageCategories: false,
    ragQuestionsPerDay: 0,
    agentQuestionsPerDay: 0,
  },
  GOLD: {
    bankAccounts: 5,
    transactionsPerDay: 200,
    canManageCategories: true,
    ragQuestionsPerDay: 20,
    agentQuestionsPerDay: 20,
  },
  PLATINUM: {
    bankAccounts: Infinity,
    transactionsPerDay: Infinity,
    canManageCategories: true,
    // Capped even here: unlike transactions, every AI call costs money.
    ragQuestionsPerDay: 50,
    agentQuestionsPerDay: 50,
  },
  ADMINISTRATOR: {
    bankAccounts: Infinity,
    transactionsPerDay: Infinity,
    canManageCategories: true,
    ragQuestionsPerDay: Infinity,
    agentQuestionsPerDay: Infinity,
  },
};
