import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Plan } from '@prisma/client';
import { mock, mockDeep } from 'jest-mock-extended';
import { PrismaService } from '@shared/database/prisma.service';
import { AiUsageRepository } from '@shared/llm/ai-usage.repository';
import { bankAccountRow, userRow } from '../../../test/helpers/prisma-rows';
import { anyInstance } from '../../../test/helpers/match';
import { PlanGuardService } from './plan-guard.service';

const makePrisma = () => mockDeep<PrismaService>();

describe('PlanGuardService', () => {
  describe('validateBankAccountLimit', () => {
    it('allows creation when under limit', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue(userRow({ plan: 'FREE' }));
      prisma.bankAccount.count.mockResolvedValue(2);

      const svc = new PlanGuardService(prisma, mock<AiUsageRepository>());
      await expect(svc.validateBankAccountLimit('u1')).resolves.toBeUndefined();
    });

    it('throws when at limit', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue(userRow({ plan: 'FREE' }));
      prisma.bankAccount.count.mockResolvedValue(3);

      const svc = new PlanGuardService(prisma, mock<AiUsageRepository>());
      await expect(svc.validateBankAccountLimit('u1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('never throws for PLATINUM', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue(userRow({ plan: 'PLATINUM' }));
      prisma.bankAccount.count.mockResolvedValue(999);

      const svc = new PlanGuardService(prisma, mock<AiUsageRepository>());
      await expect(svc.validateBankAccountLimit('u1')).resolves.toBeUndefined();
    });
  });

  describe('validateCategoryAccess', () => {
    it('throws for FREE plan', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue(userRow({ plan: 'FREE' }));

      const svc = new PlanGuardService(prisma, mock<AiUsageRepository>());
      await expect(svc.validateCategoryAccess('u1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows GOLD plan', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue(userRow({ plan: 'GOLD' }));

      const svc = new PlanGuardService(prisma, mock<AiUsageRepository>());
      await expect(svc.validateCategoryAccess('u1')).resolves.toBeUndefined();
    });
  });

  describe('getActiveAccountIds', () => {
    it('returns isUnlimited for PLATINUM', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue(userRow({ plan: 'PLATINUM' }));

      const svc = new PlanGuardService(prisma, mock<AiUsageRepository>());
      const result = await svc.getActiveAccountIds('u1');
      expect(result.isUnlimited).toBe(true);
    });

    it('returns set of first N account ids for FREE', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue(userRow({ plan: 'FREE' }));
      prisma.bankAccount.findMany.mockResolvedValue([
        bankAccountRow({ id: 'a1' }),
        bankAccountRow({ id: 'a2' }),
        bankAccountRow({ id: 'a3' }),
      ]);

      const svc = new PlanGuardService(prisma, mock<AiUsageRepository>());
      const result = await svc.getActiveAccountIds('u1');
      expect(result.isUnlimited).toBe(false);
      expect(result.ids.has('a1')).toBe(true);
      expect(result.ids.has('a3')).toBe(true);
      expect(prisma.bankAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 }),
      );
    });

    it('returns isUnlimited for ADMINISTRATOR without querying accounts', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue(
        userRow({ plan: 'ADMINISTRATOR' }),
      );

      const svc = new PlanGuardService(prisma, mock<AiUsageRepository>());
      const result = await svc.getActiveAccountIds('u1');
      expect(result.isUnlimited).toBe(true);
      expect(result.ids.size).toBe(0);
      expect(prisma.bankAccount.findMany).toHaveBeenCalledTimes(0);
    });
  });

  describe('validateDailyTransactionLimit', () => {
    it('allows when under limit for FREE plan', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue(userRow({ plan: 'FREE' }));
      prisma.transaction.count.mockResolvedValue(30);

      const svc = new PlanGuardService(prisma, mock<AiUsageRepository>());
      await expect(
        svc.validateDailyTransactionLimit('u1'),
      ).resolves.toBeUndefined();
    });

    it('throws when at limit for FREE plan', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue(userRow({ plan: 'FREE' }));
      prisma.transaction.count.mockResolvedValue(50);

      const svc = new PlanGuardService(prisma, mock<AiUsageRepository>());
      await expect(svc.validateDailyTransactionLimit('u1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('never throws for ADMINISTRATOR plan', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue(
        userRow({ plan: 'ADMINISTRATOR' }),
      );

      const svc = new PlanGuardService(prisma, mock<AiUsageRepository>());
      await expect(
        svc.validateDailyTransactionLimit('u1'),
      ).resolves.toBeUndefined();
      expect(prisma.transaction.count).toHaveBeenCalledTimes(0);
    });
  });

  describe('validateBankAccountIsActive', () => {
    it('allows when account id is in active set', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue(userRow({ plan: 'FREE' }));
      prisma.bankAccount.findMany.mockResolvedValue([
        bankAccountRow({ id: 'a1' }),
        bankAccountRow({ id: 'a2' }),
      ]);

      const svc = new PlanGuardService(prisma, mock<AiUsageRepository>());
      await expect(
        svc.validateBankAccountIsActive('u1', 'a1'),
      ).resolves.toBeUndefined();
    });

    it('throws when account id is not in active set', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue(userRow({ plan: 'FREE' }));
      prisma.bankAccount.findMany.mockResolvedValue([
        bankAccountRow({ id: 'a1' }),
        bankAccountRow({ id: 'a2' }),
      ]);

      const svc = new PlanGuardService(prisma, mock<AiUsageRepository>());
      await expect(svc.validateBankAccountIsActive('u1', 'a3')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows any account id when isUnlimited is true', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue(userRow({ plan: 'PLATINUM' }));

      const svc = new PlanGuardService(prisma, mock<AiUsageRepository>());
      await expect(
        svc.validateBankAccountIsActive('u1', 'any-id'),
      ).resolves.toBeUndefined();
      expect(prisma.bankAccount.findMany).toHaveBeenCalledTimes(0);
    });
  });
});

describe('PlanGuardService AI limits', () => {
  function build(
    plan: Plan,
    counts: { rag?: number; agent?: number; spend?: number } = {},
  ) {
    const prisma = mockDeep<PrismaService>();
    prisma.user.findUnique.mockResolvedValue(userRow({ plan }));
    prisma.agentRun.count.mockResolvedValue(counts.agent ?? 0);
    const usage = mock<AiUsageRepository>();
    usage.countForUserToday.mockResolvedValue(counts.rag ?? 0);
    usage.spendToday.mockResolvedValue(counts.spend ?? 0);
    return {
      svc: new PlanGuardService(prisma, usage),
      prisma,
      usage,
    };
  }

  const saved = process.env.AI_DAILY_SPEND_LIMIT_USD;
  afterEach(() => {
    if (saved === undefined) delete process.env.AI_DAILY_SPEND_LIMIT_USD;
    else process.env.AI_DAILY_SPEND_LIMIT_USD = saved;
  });

  it.each(['rag', 'agent'] as const)(
    'refuses FREE users any %s question, pointing at the paid plans',
    async (feature) => {
      await expect(
        build('FREE').svc.validateDailyAiQuota('u1', feature),
      ).rejects.toThrow(
        new ForbiddenException('AI features require a GOLD or PLATINUM plan.'),
      );
    },
  );

  it.each([
    ['GOLD', 'rag', 19, true],
    ['GOLD', 'rag', 20, false],
    ['GOLD', 'agent', 20, false],
    ['PLATINUM', 'rag', 49, true],
    ['PLATINUM', 'agent', 50, false],
  ] as const)(
    '%s %s with %i used today → allowed: %s',
    async (plan, feature, used, allowed) => {
      const { svc } = build(plan, { [feature]: used });
      const check = svc.validateDailyAiQuota('u1', feature);
      if (allowed) await expect(check).resolves.toBeUndefined();
      else
        await expect(check).rejects.toThrow(
          /Your plan includes \d+ .* per day/,
        );
    },
  );

  it('counts agent questions from agent runs and RAG questions from usage rows', async () => {
    const { svc, prisma, usage } = build('GOLD');
    await svc.validateDailyAiQuota('u1', 'agent');
    await svc.validateDailyAiQuota('u1', 'rag');
    expect(prisma.agentRun.count).toHaveBeenCalledWith({
      where: { userId: 'u1', createdAt: { gte: anyInstance(Date) } },
    });
    expect(usage.countForUserToday).toHaveBeenCalledWith('u1', 'rag');
  });

  it('never limits ADMINISTRATOR', async () => {
    const { svc, usage } = build('ADMINISTRATOR', { rag: 10_000 });
    await expect(
      svc.validateDailyAiQuota('u1', 'rag'),
    ).resolves.toBeUndefined();
    expect(usage.countForUserToday).not.toHaveBeenCalled();
  });

  it("answers 503 once today's spend reaches the ceiling (default US$ 1)", async () => {
    delete process.env.AI_DAILY_SPEND_LIMIT_USD;
    await expect(
      build('GOLD', { spend: 0.99 }).svc.validateGlobalAiBudget(),
    ).resolves.toBeUndefined();
    await expect(
      build('GOLD', { spend: 1 }).svc.validateGlobalAiBudget(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('reads the ceiling from AI_DAILY_SPEND_LIMIT_USD', async () => {
    process.env.AI_DAILY_SPEND_LIMIT_USD = '5';
    await expect(
      build('GOLD', { spend: 4.5 }).svc.validateGlobalAiBudget(),
    ).resolves.toBeUndefined();
  });

  it('treats AI_DAILY_SPEND_LIMIT_USD=0 as AI switched off, not as the default', async () => {
    process.env.AI_DAILY_SPEND_LIMIT_USD = '0';
    await expect(
      build('GOLD', { spend: 0 }).svc.validateGlobalAiBudget(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('falls back to US$ 1 when AI_DAILY_SPEND_LIMIT_USD is not a number', async () => {
    process.env.AI_DAILY_SPEND_LIMIT_USD = 'abc';
    await expect(
      build('GOLD', { spend: 0.5 }).svc.validateGlobalAiBudget(),
    ).resolves.toBeUndefined();
    await expect(
      build('GOLD', { spend: 1 }).svc.validateGlobalAiBudget(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('reports whether the budget is exhausted without throwing (for background jobs)', async () => {
    await expect(
      build('GOLD', { spend: 2 }).svc.isAiBudgetExhausted(),
    ).resolves.toBe(true);
    await expect(
      build('GOLD', { spend: 0 }).svc.isAiBudgetExhausted(),
    ).resolves.toBe(false);
  });
});
