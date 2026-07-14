jest.mock('@shared/config/env', () => ({
  env: {
    stripeSecretKey: 'sk_test_fake',
    stripePriceGold: 'price_gold',
    stripePricePlatinum: 'price_platinum',
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsService } from './transactions.service';
import { TransactionsRepository } from '../domain/repositories/transactions.repository';
import { ValidateBankAccountOwnershipService } from '@modules/bank-accounts/application/validate-bank-account-ownership.service';
import { ValidateCategoryOwnershipService } from '@modules/categories/application/validate-category-ownership.service';
import { ValidateTransactionOwnershipService } from './validate-transaction-ownership.service';
import { PlanGuardService } from '@shared/plan/plan-guard.service';

const mockTransactionsRepository = {
  findMany: jest.fn(),
  create: jest.fn(),
  findFirst: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

const mockValidateBankAccountOwnershipService = {
  validate: jest.fn(),
};

const mockValidateCategoryOwnershipService = {
  validate: jest.fn(),
};

const mockValidateTransactionOwnershipService = {
  validate: jest.fn(),
};

const mockPlanGuardService = {
  validateDailyTransactionLimit: jest.fn(),
  validateBankAccountIsActive: jest.fn(),
};

const makeService = async () => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TransactionsService,
      { provide: TransactionsRepository, useValue: mockTransactionsRepository },
      {
        provide: ValidateBankAccountOwnershipService,
        useValue: mockValidateBankAccountOwnershipService,
      },
      {
        provide: ValidateCategoryOwnershipService,
        useValue: mockValidateCategoryOwnershipService,
      },
      {
        provide: ValidateTransactionOwnershipService,
        useValue: mockValidateTransactionOwnershipService,
      },
      {
        provide: PlanGuardService,
        useValue: mockPlanGuardService,
      },
    ],
  }).compile();
  return module.get<TransactionsService>(TransactionsService);
};

describe('TransactionsService', () => {
  let service: TransactionsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    service = await makeService();
  });

  describe('findAllByUserId', () => {
    it('returns paginated meta with defaults when page/limit omitted', async () => {
      mockTransactionsRepository.findMany.mockResolvedValue({
        data: [],
        total: 0,
      });

      const result = await service.findAllByUserId('user-1', {
        month: 6,
        year: 2026,
      });

      expect(result.meta).toEqual({
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });
    });

    it('computes totalPages correctly', async () => {
      mockTransactionsRepository.findMany.mockResolvedValue({
        data: [],
        total: 87,
      });

      const result = await service.findAllByUserId('user-1', {
        month: 6,
        year: 2026,
        page: 2,
        limit: 20,
      });

      expect(result.meta).toEqual({
        total: 87,
        page: 2,
        limit: 20,
        totalPages: 5,
      });
    });

    it('passes page and limit to repository', async () => {
      mockTransactionsRepository.findMany.mockResolvedValue({
        data: [],
        total: 0,
      });

      await service.findAllByUserId('user-1', {
        month: 6,
        year: 2026,
        page: 3,
        limit: 10,
      });

      expect(mockTransactionsRepository.findMany).toHaveBeenCalledWith(
        'user-1',
        {
          month: 6,
          year: 2026,
          page: 3,
          limit: 10,
        },
      );
    });
  });

  describe('create', () => {
    const createDto = {
      bankAccountId: 'bank-account-1',
      categoryId: 'category-1',
      name: 'Groceries',
      value: 100,
      date: '2026-07-14T00:00:00.000Z',
      type: 'OUTCOME',
    } as const;

    it('runs all ownership and plan-guard checks with correct args', async () => {
      mockTransactionsRepository.create.mockResolvedValue({ id: 'tx-1' });

      await service.create('user-1', createDto as any);

      expect(
        mockValidateBankAccountOwnershipService.validate,
      ).toHaveBeenCalledWith('user-1', createDto.bankAccountId);
      expect(
        mockValidateCategoryOwnershipService.validate,
      ).toHaveBeenCalledWith('user-1', createDto.categoryId);
      expect(
        mockPlanGuardService.validateDailyTransactionLimit,
      ).toHaveBeenCalledWith('user-1');
      expect(
        mockPlanGuardService.validateBankAccountIsActive,
      ).toHaveBeenCalledWith('user-1', createDto.bankAccountId);
    });

    it('propagates rejection from ownership validation and does not call repository', async () => {
      mockValidateBankAccountOwnershipService.validate.mockRejectedValue(
        new Error('bank account not found'),
      );

      await expect(service.create('user-1', createDto as any)).rejects.toThrow(
        'bank account not found',
      );

      expect(mockTransactionsRepository.create).not.toHaveBeenCalled();
    });

    it('propagates rejection from plan guard daily limit check and does not call repository', async () => {
      mockPlanGuardService.validateDailyTransactionLimit.mockRejectedValue(
        new Error('daily limit reached'),
      );

      await expect(service.create('user-1', createDto as any)).rejects.toThrow(
        'daily limit reached',
      );

      expect(mockTransactionsRepository.create).not.toHaveBeenCalled();
    });

    it('propagates rejection from plan guard bank account active check and does not call repository', async () => {
      mockPlanGuardService.validateBankAccountIsActive.mockRejectedValue(
        new Error('bank account is not active'),
      );

      await expect(service.create('user-1', createDto as any)).rejects.toThrow(
        'bank account is not active',
      );

      expect(mockTransactionsRepository.create).not.toHaveBeenCalled();
    });

    it('calls repository.create with correct shape, converting date to Date', async () => {
      mockTransactionsRepository.create.mockResolvedValue({ id: 'tx-1' });

      await service.create('user-1', createDto as any);

      expect(mockTransactionsRepository.create).toHaveBeenCalledWith({
        userId: 'user-1',
        bankAccountId: createDto.bankAccountId,
        categoryId: createDto.categoryId,
        name: createDto.name,
        value: createDto.value,
        date: new Date(createDto.date),
        type: createDto.type,
      });
    });
  });

  describe('update', () => {
    const updateDto = {
      bankAccountId: 'bank-account-1',
      categoryId: 'category-1',
      name: 'Rent',
      value: 500,
      date: '2026-07-01T00:00:00.000Z',
      type: 'OUTCOME',
    } as const;

    it('validates ownership of transaction, bank account, and category', async () => {
      mockTransactionsRepository.update.mockResolvedValue({ id: 'tx-1' });

      await service.update('user-1', 'tx-1', updateDto as any);

      expect(
        mockValidateTransactionOwnershipService.validate,
      ).toHaveBeenCalledWith('user-1', 'tx-1');
      expect(
        mockValidateBankAccountOwnershipService.validate,
      ).toHaveBeenCalledWith('user-1', updateDto.bankAccountId);
      expect(
        mockValidateCategoryOwnershipService.validate,
      ).toHaveBeenCalledWith('user-1', updateDto.categoryId);
    });

    it('propagates rejection from transaction ownership validation and does not call repository', async () => {
      mockValidateTransactionOwnershipService.validate.mockRejectedValue(
        new Error('transaction not found'),
      );

      await expect(
        service.update('user-1', 'tx-1', updateDto as any),
      ).rejects.toThrow('transaction not found');

      expect(mockTransactionsRepository.update).not.toHaveBeenCalled();
    });

    it('calls repository.update with correct shape, converting date to Date', async () => {
      mockTransactionsRepository.update.mockResolvedValue({ id: 'tx-1' });

      await service.update('user-1', 'tx-1', updateDto as any);

      expect(mockTransactionsRepository.update).toHaveBeenCalledWith('tx-1', {
        bankAccountId: updateDto.bankAccountId,
        categoryId: updateDto.categoryId,
        name: updateDto.name,
        value: updateDto.value,
        date: new Date(updateDto.date),
        type: updateDto.type,
      });
    });
  });

  describe('remove', () => {
    it('validates transaction ownership before deleting', async () => {
      mockTransactionsRepository.delete.mockResolvedValue(undefined);

      await service.remove('user-1', 'tx-1');

      expect(
        mockValidateTransactionOwnershipService.validate,
      ).toHaveBeenCalledWith('user-1', 'tx-1');
      expect(mockTransactionsRepository.delete).toHaveBeenCalledWith('tx-1');
    });

    it('propagates rejection from ownership validation and does not call repository', async () => {
      mockValidateTransactionOwnershipService.validate.mockRejectedValue(
        new Error('transaction not found'),
      );

      await expect(service.remove('user-1', 'tx-1')).rejects.toThrow(
        'transaction not found',
      );

      expect(mockTransactionsRepository.delete).not.toHaveBeenCalled();
    });
  });
});
