import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';
import { RefreshTokensRepository } from '../../domain/repositories/refresh-tokens.repository';
import { type RefreshTokenEntity } from '../../entities/RefreshToken';

@Injectable()
export class RefreshTokensPrismaRepository implements RefreshTokensRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create(
    userId: string,
    token: string,
    expiresAt: Date,
  ): Promise<RefreshTokenEntity> {
    return this.prismaService.refreshToken.create({
      data: { userId, token, expiresAt },
    });
  }

  findByToken(token: string): Promise<RefreshTokenEntity | null> {
    return this.prismaService.refreshToken.findUnique({ where: { token } });
  }

  async deleteByToken(token: string): Promise<void> {
    await this.prismaService.refreshToken.deleteMany({ where: { token } });
  }

  async deleteExpired(): Promise<void> {
    await this.prismaService.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }
}
