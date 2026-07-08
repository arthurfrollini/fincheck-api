import { type TransactionType } from '@modules/transactions/entities/Transaction';

export const Role = {
  USER: 'USER',
  ADMINISTRATOR: 'ADMINISTRATOR',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const Plan = {
  FREE: 'FREE',
  GOLD: 'GOLD',
  PLATINUM: 'PLATINUM',
  ADMINISTRATOR: 'ADMINISTRATOR',
} as const;
export type Plan = (typeof Plan)[keyof typeof Plan];

export interface UserEntity {
  id: string;
  name: string;
  email: string;
  password: string | null;
  role: Role;
  plan: Plan;
  googleId: string | null;
  avatarUrl: string | null;
  pendingEmail: string | null;
  emailToken: string | null;
  emailTokenExpiresAt: Date | null;
  stripeCustomerId: string | null;
  stripePriceId: string | null;
}

export interface UserCreate {
  name: string;
  email: string;
  password?: string | null;
  role?: Role;
  googleId?: string;
  categories?: Array<{ name: string; icon: string; type: TransactionType }>;
}

export interface UserUpdate {
  name?: string;
  email?: string;
  role?: Role;
  plan?: Plan;
  googleId?: string;
  avatarUrl?: string | null;
  pendingEmail?: string | null;
  emailToken?: string | null;
  emailTokenExpiresAt?: Date | null;
  stripeCustomerId?: string | null;
  stripePriceId?: string | null;
}
