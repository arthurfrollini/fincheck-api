import { type RefreshToken } from '@prisma/client';

export abstract class RefreshTokensRepository {
  abstract create(
    userId: string,
    token: string,
    expiresAt: Date,
  ): Promise<RefreshToken>;
  abstract findByToken(token: string): Promise<RefreshToken | null>;
  abstract deleteByToken(token: string): Promise<void>;
}
