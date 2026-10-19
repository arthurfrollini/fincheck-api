import { mock, type MockProxy } from 'jest-mock-extended';
import { bankAccountRow } from '../../../../test/helpers/prisma-rows';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { BankAccountsService } from './bank-accounts.service';
import { BankAccountsRepository } from '../domain/repositories/bank-accounts.repository';
import { ValidateBankAccountOwnershipService } from './validate-bank-account-ownership.service';
import { PlanGuardService } from '@shared/plan/plan-guard.service';
import { TransactionType } from '@modules/transactions/entities/Transaction';
import { BankAccountType } from '../entities/BankAccount';
import { only } from '../../../../test/helpers/must';

jest.mock('@shared/config/env', () => ({
  env: {
    stripeSecretKey: 'sk_test_fake',
    stripePriceGold: 'price_gold',
    stripePricePlatinum: 'price_platinum',
  },
}));

const USER_ID = 'user-1';
const ACCOUNT_ID = 'account-1';

describe('BankAccountsService', () => {
  let service: BankAccountsService;
  let mockBankAccountsRepository: MockProxy<BankAccountsRepository>;
  let mockValidateOwnership: MockProxy<ValidateBankAccountOwnershipService>;
  let mockPlanGuard: MockProxy<PlanGuardService>;

  beforeEach(async () => {
    mockBankAccountsRepository = mock<BankAccountsRepository>();
    mockValidateOwnership = mock<ValidateBankAccountOwnershipService>();
    mockPlanGuard = mock<PlanGuardService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BankAccountsService,
        {
          provide: BankAccountsRepository,
          useValue: mockBankAccountsRepository,
        },
        {
          provide: ValidateBankAccountOwnershipService,
          useValue: mockValidateOwnership,
        },
        { provide: PlanGuardService, useValue: mockPlanGuard },
      ],
    }).compile();

    service = module.get<BankAccountsService>(BankAccountsService);
  });

  describe('create', () => {
    const dto = {
      name: 'Checking',
      color: '#000000',
      initialBalance: 100,
      type: BankAccountType.CHECKING,
    };

    it('calls planGuard.validateBankAccountLimit then bankAccountsRepository.create', async () => {
      const created = { id: ACCOUNT_ID, userId: USER_ID, ...dto };
      mockPlanGuard.validateBankAccountLimit.mockResolvedValue(undefined);
      mockBankAccountsRepository.create.mockResolvedValue(created);

      const result = await service.create(USER_ID, dto);

      expect(mockPlanGuard.validateBankAccountLimit).toHaveBeenCalledWith(
        USER_ID,
      );
      expect(mockBankAccountsRepository.create).toHaveBeenCalledWith({
        userId: USER_ID,
        name: dto.name,
        color: dto.color,
        initialBalance: dto.initialBalance,
        type: dto.type,
      });
      expect(result).toEqual(created);
    });

    it('propagates ForbiddenException when plan limit reached', async () => {
      mockPlanGuard.validateBankAccountLimit.mockRejectedValue(
        new ForbiddenException('Limit reached'),
      );

      await expect(service.create(USER_ID, dto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockBankAccountsRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('findAllByUserId', () => {
    const makeAccount = (
      id: string,
      initialBalance: number,
      transactions: { value: number; type: TransactionType }[],
    ) => ({
      id,
      userId: USER_ID,
      name: 'My Account',
      color: '#000000',
      initialBalance,
      type: BankAccountType.CHECKING,
      transactions,
    });

    it('computes currentBalance = initialBalance + INCOME - EXPENSE', async () => {
      const account = makeAccount(ACCOUNT_ID, 100, [
        { value: 50, type: TransactionType.INCOME },
        { value: 30, type: TransactionType.EXPENSE },
      ]);
      mockBankAccountsRepository.findManyWithTransactions.mockResolvedValue([
        account,
      ]);
      mockPlanGuard.getActiveAccountIds.mockResolvedValue({
        ids: new Set([ACCOUNT_ID]),
        isUnlimited: false,
      });

      const result = only(await service.findAllByUserId(USER_ID), 'account');

      // 100 + 50 - 30 = 120
      expect(result.currentBalance).toBe(120);
      expect(result).not.toHaveProperty('transactions');
    });

    it('sets isActive: true for accounts in activeIds set', async () => {
      const account = makeAccount(ACCOUNT_ID, 0, []);
      mockBankAccountsRepository.findManyWithTransactions.mockResolvedValue([
        account,
      ]);
      mockPlanGuard.getActiveAccountIds.mockResolvedValue({
        ids: new Set([ACCOUNT_ID]),
        isUnlimited: false,
      });

      const result = only(await service.findAllByUserId(USER_ID), 'account');

      expect(result.isActive).toBe(true);
    });

    it('sets isActive: true for all accounts when isUnlimited: true', async () => {
      const account = makeAccount(ACCOUNT_ID, 0, []);
      mockBankAccountsRepository.findManyWithTransactions.mockResolvedValue([
        account,
      ]);
      mockPlanGuard.getActiveAccountIds.mockResolvedValue({
        ids: new Set<string>(),
        isUnlimited: true,
      });

      const result = only(await service.findAllByUserId(USER_ID), 'account');

      expect(result.isActive).toBe(true);
    });

    it('sets isActive: false for accounts NOT in activeIds when not unlimited', async () => {
      const account = makeAccount(ACCOUNT_ID, 0, []);
      mockBankAccountsRepository.findManyWithTransactions.mockResolvedValue([
        account,
      ]);
      mockPlanGuard.getActiveAccountIds.mockResolvedValue({
        ids: new Set<string>(),
        isUnlimited: false,
      });

      const result = only(await service.findAllByUserId(USER_ID), 'account');

      expect(result.isActive).toBe(false);
    });
  });

  describe('update', () => {
    const dto = {
      name: 'Updated',
      color: '#ffffff',
      initialBalance: 200,
      type: BankAccountType.INVESTMENT,
    };

    it('calls validateOwnership.validate then bankAccountsRepository.update', async () => {
      const updated = bankAccountRow({
        id: ACCOUNT_ID,
        userId: USER_ID,
        ...dto,
      });
      mockValidateOwnership.validate.mockResolvedValue(
        bankAccountRow({ id: ACCOUNT_ID }),
      );
      mockBankAccountsRepository.update.mockResolvedValue(updated);

      const result = await service.update(USER_ID, ACCOUNT_ID, dto);

      expect(mockValidateOwnership.validate).toHaveBeenCalledWith(
        USER_ID,
        ACCOUNT_ID,
      );
      expect(mockBankAccountsRepository.update).toHaveBeenCalledWith(
        ACCOUNT_ID,
        {
          name: dto.name,
          color: dto.color,
          initialBalance: dto.initialBalance,
          type: dto.type,
        },
      );
      expect(result).toEqual(updated);
    });
  });

  describe('remove', () => {
    it('calls validateOwnership.validate then bankAccountsRepository.delete', async () => {
      mockValidateOwnership.validate.mockResolvedValue(
        bankAccountRow({ id: ACCOUNT_ID }),
      );
      mockBankAccountsRepository.delete.mockResolvedValue(undefined);

      await service.remove(USER_ID, ACCOUNT_ID);

      expect(mockValidateOwnership.validate).toHaveBeenCalledWith(
        USER_ID,
        ACCOUNT_ID,
      );
      expect(mockBankAccountsRepository.delete).toHaveBeenCalledWith(
        ACCOUNT_ID,
      );
    });
  });
});
