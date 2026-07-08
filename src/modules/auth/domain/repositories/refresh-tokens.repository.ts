import { type RefreshTokenEntity } from '../../entities/RefreshToken';

export abstract class RefreshTokensRepository {
  abstract create(
    userId: string,
    token: string,
    expiresAt: Date,
  ): Promise<RefreshTokenEntity>;
  abstract findByToken(token: string): Promise<RefreshTokenEntity | null>;
  abstract deleteByToken(token: string): Promise<void>;
  abstract deleteExpired(): Promise<void>;
}
