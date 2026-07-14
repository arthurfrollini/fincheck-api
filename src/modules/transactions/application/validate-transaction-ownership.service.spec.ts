import { Test, TestingModule } from '@nestjs/testing';
import { ValidateTransactionOwnershipService } from './validate-transaction-ownership.service';
import { TransactionsRepository } from '../domain/repositories/transactions.repository';

describe('ValidateTransactionOwnershipService', () => {
  let service: ValidateTransactionOwnershipService;
  let mockRepository: { findFirst: jest.Mock };

  beforeEach(async () => {
    mockRepository = { findFirst: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidateTransactionOwnershipService,
        { provide: TransactionsRepository, useValue: mockRepository },
      ],
    }).compile();

    service = module.get(ValidateTransactionOwnershipService);
  });

  it('returns the entity when found', async () => {
    const entity = { id: 'transaction-1', userId: 'user-1' };
    mockRepository.findFirst.mockResolvedValue(entity);

    const result = await service.validate('user-1', 'transaction-1');

    expect(result).toEqual(entity);
    expect(mockRepository.findFirst).toHaveBeenCalledWith(
      'transaction-1',
      'user-1',
    );
  });

  it('throws NotFoundException when not found', async () => {
    mockRepository.findFirst.mockResolvedValue(null);

    await expect(service.validate('user-1', 'transaction-1')).rejects.toThrow(
      'Transaction not found.',
    );
  });
});
