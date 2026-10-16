import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';
import { AiUsageRepository, type AiUsageRow } from './ai-usage.repository';
import { type LlmFeature } from './llm.types';

function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

@Injectable()
export class AiUsagePrismaRepository implements AiUsageRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async record(row: AiUsageRow): Promise<void> {
    await this.prismaService.aiUsage.create({ data: row });
  }

  countForUserToday(userId: string, feature: LlmFeature): Promise<number> {
    return this.prismaService.aiUsage.count({
      where: { userId, feature, createdAt: { gte: startOfUtcDay() } },
    });
  }

  async spendToday(): Promise<number> {
    const { _sum } = await this.prismaService.aiUsage.aggregate({
      where: { createdAt: { gte: startOfUtcDay() } },
      _sum: { costUsd: true },
    });
    return _sum.costUsd ?? 0;
  }
}
