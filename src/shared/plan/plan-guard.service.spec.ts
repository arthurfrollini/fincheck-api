import { ForbiddenException } from '@nestjs/common';
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
