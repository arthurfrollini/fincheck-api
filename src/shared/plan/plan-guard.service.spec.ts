import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PlanGuardService } from './plan-guard.service';

const makePrisma = (overrides: Record<string, unknown> = {}) => ({
  user: { findUnique: jest.fn() },
  bankAccount: { count: jest.fn(), findMany: jest.fn() },
  transaction: { count: jest.fn() },
  ...overrides,
});

describe('PlanGuardService', () => {
  describe('validateBankAccountLimit', () => {
    it('allows creation when under limit', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ plan: 'FREE' });
      prisma.bankAccount.count.mockResolvedValue(2);

      const svc = new PlanGuardService(prisma as any);
      await expect(svc.validateBankAccountLimit('u1')).resolves.toBeUndefined();
    });

    it('throws when at limit', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ plan: 'FREE' });
      prisma.bankAccount.count.mockResolvedValue(3);

      const svc = new PlanGuardService(prisma as any);
      await expect(svc.validateBankAccountLimit('u1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('never throws for PLATINUM', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({
        plan: 'PLATINUM',
      });
      prisma.bankAccount.count.mockResolvedValue(999);

      const svc = new PlanGuardService(prisma as any);
      await expect(svc.validateBankAccountLimit('u1')).resolves.toBeUndefined();
    });
  });

  describe('validateCategoryAccess', () => {
    it('throws for FREE plan', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ plan: 'FREE' });

      const svc = new PlanGuardService(prisma as any);
      await expect(svc.validateCategoryAccess('u1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows GOLD plan', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ plan: 'GOLD' });

      const svc = new PlanGuardService(prisma as any);
      await expect(svc.validateCategoryAccess('u1')).resolves.toBeUndefined();
    });
  });

  describe('getActiveAccountIds', () => {
    it('returns isUnlimited for PLATINUM', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({
        plan: 'PLATINUM',
      });

      const svc = new PlanGuardService(prisma as any);
      const result = await svc.getActiveAccountIds('u1');
      expect(result.isUnlimited).toBe(true);
    });

    it('returns set of first N account ids for FREE', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ plan: 'FREE' });
      prisma.bankAccount.findMany.mockResolvedValue([
        { id: 'a1' },
        { id: 'a2' },
        { id: 'a3' },
      ]);

      const svc = new PlanGuardService(prisma as any);
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
      prisma.user.findUnique.mockResolvedValue({
        plan: 'ADMINISTRATOR',
      });

      const svc = new PlanGuardService(prisma as any);
      const result = await svc.getActiveAccountIds('u1');
      expect(result.isUnlimited).toBe(true);
      expect(result.ids.size).toBe(0);
      expect(prisma.bankAccount.findMany).toHaveBeenCalledTimes(0);
    });
  });

  describe('validateDailyTransactionLimit', () => {
    it('allows when under limit for FREE plan', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ plan: 'FREE' });
      prisma.transaction.count.mockResolvedValue(30);

      const svc = new PlanGuardService(prisma as any);
      await expect(
        svc.validateDailyTransactionLimit('u1'),
      ).resolves.toBeUndefined();
    });

    it('throws when at limit for FREE plan', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ plan: 'FREE' });
      prisma.transaction.count.mockResolvedValue(50);

      const svc = new PlanGuardService(prisma as any);
      await expect(svc.validateDailyTransactionLimit('u1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('never throws for ADMINISTRATOR plan', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({
        plan: 'ADMINISTRATOR',
      });

      const svc = new PlanGuardService(prisma as any);
      await expect(
        svc.validateDailyTransactionLimit('u1'),
      ).resolves.toBeUndefined();
      expect(prisma.transaction.count).toHaveBeenCalledTimes(0);
    });
  });

  describe('validateBankAccountIsActive', () => {
    it('allows when account id is in active set', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ plan: 'FREE' });
      prisma.bankAccount.findMany.mockResolvedValue([
        { id: 'a1' },
        { id: 'a2' },
      ]);

      const svc = new PlanGuardService(prisma as any);
      await expect(
        svc.validateBankAccountIsActive('u1', 'a1'),
      ).resolves.toBeUndefined();
    });

    it('throws when account id is not in active set', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ plan: 'FREE' });
      prisma.bankAccount.findMany.mockResolvedValue([
        { id: 'a1' },
        { id: 'a2' },
      ]);

      const svc = new PlanGuardService(prisma as any);
      await expect(svc.validateBankAccountIsActive('u1', 'a3')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows any account id when isUnlimited is true', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ plan: 'PLATINUM' });

      const svc = new PlanGuardService(prisma as any);
      await expect(
        svc.validateBankAccountIsActive('u1', 'any-id'),
      ).resolves.toBeUndefined();
      expect(prisma.bankAccount.findMany).toHaveBeenCalledTimes(0);
    });
  });
});

describe('PlanGuardService AI limits', () => {
  function build(
    plan: string,
    counts: { rag?: number; agent?: number; spend?: number } = {},
  ) {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ plan }) },
      agentRun: { count: jest.fn().mockResolvedValue(counts.agent ?? 0) },
    };
    const usage = {
      countForUserToday: jest.fn().mockResolvedValue(counts.rag ?? 0),
      spendToday: jest.fn().mockResolvedValue(counts.spend ?? 0),
      record: jest.fn(),
    };
    return {
      svc: new PlanGuardService(prisma as any, usage),
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
      where: { userId: 'u1', createdAt: { gte: expect.any(Date) } },
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

  it('reports whether the budget is exhausted without throwing (for background jobs)', async () => {
    await expect(
      build('GOLD', { spend: 2 }).svc.isAiBudgetExhausted(),
    ).resolves.toBe(true);
    await expect(
      build('GOLD', { spend: 0 }).svc.isAiBudgetExhausted(),
    ).resolves.toBe(false);
  });
});
