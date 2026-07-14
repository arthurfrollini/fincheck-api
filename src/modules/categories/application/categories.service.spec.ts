import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesRepository } from '../domain/repositories/categories.repository';
import { ValidateCategoryOwnershipService } from './validate-category-ownership.service';
import { PlanGuardService } from '@shared/plan/plan-guard.service';
import { CategoryType } from '@modules/categories/entities/Category';

const USER_ID = 'user-1';
const CATEGORY_ID = 'category-1';

describe('CategoriesService', () => {
  let service: CategoriesService;
  let mockCategoriesRepository: {
    findAllByUserId: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let mockValidateOwnership: { validate: jest.Mock };
  let mockPlanGuard: { validateCategoryAccess: jest.Mock };

  beforeEach(async () => {
    mockCategoriesRepository = {
      findAllByUserId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    mockValidateOwnership = { validate: jest.fn() };
    mockPlanGuard = { validateCategoryAccess: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: CategoriesRepository, useValue: mockCategoriesRepository },
        {
          provide: ValidateCategoryOwnershipService,
          useValue: mockValidateOwnership,
        },
        { provide: PlanGuardService, useValue: mockPlanGuard },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
  });

  describe('findAllByUserId', () => {
    it('calls categoriesRepository.findAllByUserId and returns its result', async () => {
      const categories = [
        {
          id: CATEGORY_ID,
          userId: USER_ID,
          name: 'Food',
          icon: 'food',
          type: CategoryType.EXPENSE,
        },
      ];
      mockCategoriesRepository.findAllByUserId.mockResolvedValue(categories);

      const result = await service.findAllByUserId(USER_ID);

      expect(mockCategoriesRepository.findAllByUserId).toHaveBeenCalledWith(
        USER_ID,
      );
      expect(result).toEqual(categories);
    });
  });

  describe('create', () => {
    const dto = {
      name: 'Food',
      icon: 'food',
      type: CategoryType.EXPENSE,
    };

    it('calls planGuard.validateCategoryAccess then categoriesRepository.create', async () => {
      const created = { id: CATEGORY_ID, userId: USER_ID, ...dto };
      mockPlanGuard.validateCategoryAccess.mockResolvedValue(undefined);
      mockCategoriesRepository.create.mockResolvedValue(created);

      const result = await service.create(USER_ID, dto);

      expect(mockPlanGuard.validateCategoryAccess).toHaveBeenCalledWith(
        USER_ID,
      );
      expect(mockCategoriesRepository.create).toHaveBeenCalledWith({
        userId: USER_ID,
        name: dto.name,
        icon: dto.icon,
        type: dto.type,
      });
      expect(result).toEqual(created);
    });

    it('propagates ForbiddenException when plan limit reached and does not create', async () => {
      mockPlanGuard.validateCategoryAccess.mockRejectedValue(
        new ForbiddenException('Limit reached'),
      );

      await expect(service.create(USER_ID, dto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockCategoriesRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const dto = { name: 'Groceries', icon: 'cart' };

    it('calls planGuard.validateCategoryAccess and validateOwnership.validate then categoriesRepository.update', async () => {
      const updated = { id: CATEGORY_ID, userId: USER_ID, ...dto };
      mockPlanGuard.validateCategoryAccess.mockResolvedValue(undefined);
      mockValidateOwnership.validate.mockResolvedValue(undefined);
      mockCategoriesRepository.update.mockResolvedValue(updated);

      const result = await service.update(USER_ID, CATEGORY_ID, dto);

      expect(mockPlanGuard.validateCategoryAccess).toHaveBeenCalledWith(
        USER_ID,
      );
      expect(mockValidateOwnership.validate).toHaveBeenCalledWith(
        USER_ID,
        CATEGORY_ID,
      );
      expect(mockCategoriesRepository.update).toHaveBeenCalledWith(
        CATEGORY_ID,
        { name: dto.name, icon: dto.icon },
      );
      expect(result).toEqual(updated);
    });

    it('propagates ForbiddenException from planGuard and does not update', async () => {
      mockPlanGuard.validateCategoryAccess.mockRejectedValue(
        new ForbiddenException('Limit reached'),
      );
      mockValidateOwnership.validate.mockResolvedValue(undefined);

      await expect(service.update(USER_ID, CATEGORY_ID, dto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockCategoriesRepository.update).not.toHaveBeenCalled();
    });

    it('propagates rejection from validateOwnership.validate and does not update', async () => {
      mockPlanGuard.validateCategoryAccess.mockResolvedValue(undefined);
      mockValidateOwnership.validate.mockRejectedValue(
        new ForbiddenException('Not owner'),
      );

      await expect(service.update(USER_ID, CATEGORY_ID, dto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockCategoriesRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('calls planGuard.validateCategoryAccess and validateOwnership.validate then categoriesRepository.delete', async () => {
      mockPlanGuard.validateCategoryAccess.mockResolvedValue(undefined);
      mockValidateOwnership.validate.mockResolvedValue(undefined);
      mockCategoriesRepository.delete.mockResolvedValue(undefined);

      await service.remove(USER_ID, CATEGORY_ID);

      expect(mockPlanGuard.validateCategoryAccess).toHaveBeenCalledWith(
        USER_ID,
      );
      expect(mockValidateOwnership.validate).toHaveBeenCalledWith(
        USER_ID,
        CATEGORY_ID,
      );
      expect(mockCategoriesRepository.delete).toHaveBeenCalledWith(CATEGORY_ID);
    });

    it('propagates ForbiddenException from planGuard and does not delete', async () => {
      mockPlanGuard.validateCategoryAccess.mockRejectedValue(
        new ForbiddenException('Limit reached'),
      );
      mockValidateOwnership.validate.mockResolvedValue(undefined);

      await expect(service.remove(USER_ID, CATEGORY_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockCategoriesRepository.delete).not.toHaveBeenCalled();
    });

    it('propagates rejection from validateOwnership.validate and does not delete', async () => {
      mockPlanGuard.validateCategoryAccess.mockResolvedValue(undefined);
      mockValidateOwnership.validate.mockRejectedValue(
        new ForbiddenException('Not owner'),
      );

      await expect(service.remove(USER_ID, CATEGORY_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockCategoriesRepository.delete).not.toHaveBeenCalled();
    });
  });
});
