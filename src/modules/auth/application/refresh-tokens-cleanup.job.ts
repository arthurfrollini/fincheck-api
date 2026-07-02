import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RefreshTokensRepository } from '../domain/repositories/refresh-tokens.repository';

@Injectable()
export class RefreshTokensCleanupJob {
  constructor(
    private readonly refreshTokensRepository: RefreshTokensRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handle() {
    await this.refreshTokensRepository.deleteExpired();
  }
}
