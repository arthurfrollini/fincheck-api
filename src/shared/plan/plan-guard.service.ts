import {
  ForbiddenException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiUsageRepository } from '@shared/llm/ai-usage.repository';
import { PrismaService } from '@shared/database/prisma.service';
import { PLAN_LIMITS } from './plan.constants';
import { Plan } from '@modules/users/entities/User';

@Injectable()
export class PlanGuardService {
  constructor(
    private readonly prismaService: PrismaService,
    @Optional() private readonly aiUsageRepository?: AiUsageRepository,
  ) {}

  async getUserPlan(userId: string): Promise<Plan> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    });
    return user?.plan ?? 'FREE';
  }

  async validateBankAccountLimit(userId: string): Promise<void> {
    const plan = await this.getUserPlan(userId);
    if (plan === Plan.ADMINISTRATOR) return;
    const limit = PLAN_LIMITS[plan].bankAccounts;
    if (limit === Infinity) return;

    const count = await this.prismaService.bankAccount.count({
      where: { userId },
    });
    if (count >= limit) {
      throw new ForbiddenException(
        `Your plan allows up to ${limit} bank account${limit === 1 ? '' : 's'}.`,
      );
    }
  }

  async validateDailyTransactionLimit(userId: string): Promise<void> {
    const plan = await this.getUserPlan(userId);
    if (plan === Plan.ADMINISTRATOR) return;
    const limit = PLAN_LIMITS[plan].transactionsPerDay;
    if (limit === Infinity) return;

    const today = new Date();
    const gte = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    const lt = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() + 1,
      ),
    );

    const count = await this.prismaService.transaction.count({
      where: { userId, createdAt: { gte, lt } },
    });

    if (count >= limit) {
      throw new ForbiddenException(
        `Daily transaction limit of ${limit} reached on your current plan.`,
      );
    }
  }

  async validateCategoryAccess(userId: string): Promise<void> {
    const plan = await this.getUserPlan(userId);
    if (plan === Plan.ADMINISTRATOR) return;
    if (!PLAN_LIMITS[plan].canManageCategories) {
      throw new ForbiddenException(
        'Category management requires a GOLD or PLATINUM plan.',
      );
    }
  }

  async getActiveAccountIds(
    userId: string,
  ): Promise<{ ids: Set<string>; isUnlimited: boolean }> {
    const plan = await this.getUserPlan(userId);
    if (plan === Plan.ADMINISTRATOR) {
      return { ids: new Set<string>(), isUnlimited: true };
    }
    const limit = PLAN_LIMITS[plan].bankAccounts;

    if (limit === Infinity) return { ids: new Set(), isUnlimited: true };

    const accounts = await this.prismaService.bankAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });

    return { ids: new Set(accounts.map((a) => a.id)), isUnlimited: false };
  }

  async validateBankAccountIsActive(
    userId: string,
    bankAccountId: string,
  ): Promise<void> {
    const { ids, isUnlimited } = await this.getActiveAccountIds(userId);
    if (isUnlimited) return;
    if (!ids.has(bankAccountId)) {
      throw new ForbiddenException(
        'This bank account is read-only on your current plan.',
      );
    }
  }

  // Per-plan daily quota for RAG and agent questions. RAG questions are
  // counted from usage rows (a question the material doesn't cover never
  // calls the model, so it records nothing and costs no quota); agent
  // questions from runs created today.
  async validateDailyAiQuota(
    userId: string,
    feature: 'rag' | 'agent',
  ): Promise<void> {
    const plan = await this.getUserPlan(userId);
    if (plan === Plan.ADMINISTRATOR) return;
    const limits = PLAN_LIMITS[plan];
    const limit =
      feature === 'rag'
        ? limits.ragQuestionsPerDay
        : limits.agentQuestionsPerDay;
    if (limit === Infinity) return;
    if (limit === 0) {
      throw new ForbiddenException(
        'AI features require a GOLD or PLATINUM plan.',
      );
    }

    const used =
      feature === 'rag'
        ? await this.aiUsageRepository!.countForUserToday(userId, 'rag')
        : await this.prismaService.agentRun.count({
            where: { userId, createdAt: { gte: startOfUtcDay() } },
          });
    if (used >= limit) {
      const label =
        feature === 'rag' ? 'education questions' : 'assistant questions';
      throw new ForbiddenException(
        `Your plan includes ${limit} ${label} per day.`,
      );
    }
  }

  // Global ceiling on today's Claude spend, across every user and feature.
  // The last guard against many accounts at once; the prepaid Anthropic
  // balance stays the hard backstop.
  async isAiBudgetExhausted(): Promise<boolean> {
    // 0 is a valid setting (AI switched off); only unset or non-numeric
    // values fall back to the default.
    const raw = process.env.AI_DAILY_SPEND_LIMIT_USD;
    const parsed = raw?.trim() ? Number(raw) : NaN;
    const limit = Number.isNaN(parsed) ? 1 : parsed;
    return (await this.aiUsageRepository!.spendToday()) >= limit;
  }

  async validateGlobalAiBudget(): Promise<void> {
    if (await this.isAiBudgetExhausted()) {
      throw new ServiceUnavailableException(
        'AI features are temporarily unavailable. Try again tomorrow.',
      );
    }
  }
}

function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}
