import { type TransactionType } from '@modules/transactions/entities/Transaction';

export const Role = {
  USER: 'USER',
  ADMINISTRATOR: 'ADMINISTRATOR',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export interface UserEntity {
  id: string;
  name: string;
  email: string;
  password: string | null;
  role: Role;
  googleId: string | null;
  pendingEmail: string | null;
  emailToken: string | null;
  emailTokenExpiresAt: Date | null;
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
  googleId?: string;
  pendingEmail?: string | null;
  emailToken?: string | null;
  emailTokenExpiresAt?: Date | null;
}
