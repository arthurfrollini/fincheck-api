import { Test, TestingModule } from '@nestjs/testing';
import { ValidateCategoryOwnershipService } from './validate-category-ownership.service';
import { CategoriesRepository } from '../domain/repositories/categories.repository';

describe('ValidateCategoryOwnershipService', () => {
  let service: ValidateCategoryOwnershipService;
  let mockRepository: { findFirst: jest.Mock };

  beforeEach(async () => {
    mockRepository = { findFirst: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidateCategoryOwnershipService,
        { provide: CategoriesRepository, useValue: mockRepository },
      ],
    }).compile();

    service = module.get(ValidateCategoryOwnershipService);
  });

  it('returns the entity when found', async () => {
    const entity = { id: 'category-1', userId: 'user-1' };
    mockRepository.findFirst.mockResolvedValue(entity);

    const result = await service.validate('user-1', 'category-1');

    expect(result).toEqual(entity);
    expect(mockRepository.findFirst).toHaveBeenCalledWith(
      'category-1',
      'user-1',
    );
  });

  it('throws NotFoundException when not found', async () => {
    mockRepository.findFirst.mockResolvedValue(null);

    await expect(service.validate('user-1', 'category-1')).rejects.toThrow(
      'Category not found.',
    );
  });
});
