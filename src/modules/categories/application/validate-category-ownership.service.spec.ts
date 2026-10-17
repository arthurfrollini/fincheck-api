import { mock, type MockProxy } from 'jest-mock-extended';
import { categoryRow } from '../../../../test/helpers/prisma-rows';
import { Test, TestingModule } from '@nestjs/testing';
import { ValidateCategoryOwnershipService } from './validate-category-ownership.service';
import { CategoriesRepository } from '../domain/repositories/categories.repository';

describe('ValidateCategoryOwnershipService', () => {
  let service: ValidateCategoryOwnershipService;
  let mockRepository: MockProxy<CategoriesRepository>;

  beforeEach(async () => {
    mockRepository = mock<CategoriesRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidateCategoryOwnershipService,
        { provide: CategoriesRepository, useValue: mockRepository },
      ],
    }).compile();

    service = module.get(ValidateCategoryOwnershipService);
  });

  it('returns the entity when found', async () => {
    const entity = categoryRow({ id: 'category-1', userId: 'user-1' });
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
