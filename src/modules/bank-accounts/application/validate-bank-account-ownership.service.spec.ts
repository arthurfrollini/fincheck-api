import { Test, TestingModule } from '@nestjs/testing';
import { ValidateBankAccountOwnershipService } from './validate-bank-account-ownership.service';
import { BankAccountsRepository } from '../domain/repositories/bank-accounts.repository';

describe('ValidateBankAccountOwnershipService', () => {
  let service: ValidateBankAccountOwnershipService;
  let mockRepository: { findFirst: jest.Mock };

  beforeEach(async () => {
    mockRepository = { findFirst: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidateBankAccountOwnershipService,
        { provide: BankAccountsRepository, useValue: mockRepository },
      ],
    }).compile();

    service = module.get(ValidateBankAccountOwnershipService);
  });

  it('returns the entity when found', async () => {
    const entity = { id: 'account-1', userId: 'user-1' };
    mockRepository.findFirst.mockResolvedValue(entity);

    const result = await service.validate('user-1', 'account-1');

    expect(result).toEqual(entity);
    expect(mockRepository.findFirst).toHaveBeenCalledWith(
      'account-1',
      'user-1',
    );
  });

  it('throws NotFoundException when not found', async () => {
    mockRepository.findFirst.mockResolvedValue(null);

    await expect(service.validate('user-1', 'account-1')).rejects.toThrow(
      'Bank account not found.',
    );
  });
});
