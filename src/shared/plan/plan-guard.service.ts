import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';
import { PLAN_LIMITS } from './plan.constants';
import { Plan } from '@modules/users/entities/User';

@Injectable()
export class PlanGuardService {
  constructor(private readonly prismaService: PrismaService) {}

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
}
