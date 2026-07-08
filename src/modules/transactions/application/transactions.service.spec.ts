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

const makeService = async () => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TransactionsService,
      { provide: TransactionsRepository, useValue: mockTransactionsRepository },
      {
        provide: ValidateBankAccountOwnershipService,
        useValue: { validate: jest.fn() },
      },
      {
        provide: ValidateCategoryOwnershipService,
        useValue: { validate: jest.fn() },
      },
      {
        provide: ValidateTransactionOwnershipService,
        useValue: { validate: jest.fn() },
      },
      {
        provide: PlanGuardService,
        useValue: { validateDailyTransactionLimit: jest.fn() },
      },
    ],
  }).compile();
  return module.get<TransactionsService>(TransactionsService);
};

describe('TransactionsService', () => {
  let service: TransactionsService;

  beforeEach(async () => {
    jest.clearAllMocks();
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
});
