import { mock, type MockProxy } from 'jest-mock-extended';
import { categoryRow } from '../../../../test/helpers/prisma-rows';
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
  let mockCategoriesRepository: MockProxy<CategoriesRepository>;
  let mockValidateOwnership: MockProxy<ValidateCategoryOwnershipService>;
  let mockPlanGuard: MockProxy<PlanGuardService>;

  beforeEach(async () => {
    mockCategoriesRepository = mock<CategoriesRepository>();
    mockValidateOwnership = mock<ValidateCategoryOwnershipService>();
    mockPlanGuard = mock<PlanGuardService>();

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
      const updated = categoryRow({ id: CATEGORY_ID, userId: USER_ID, ...dto });
      mockPlanGuard.validateCategoryAccess.mockResolvedValue(undefined);
      mockValidateOwnership.validate.mockResolvedValue(
        categoryRow({ id: CATEGORY_ID }),
      );
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
      mockValidateOwnership.validate.mockResolvedValue(
        categoryRow({ id: CATEGORY_ID }),
      );

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
      mockValidateOwnership.validate.mockResolvedValue(
        categoryRow({ id: CATEGORY_ID }),
      );
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
      mockValidateOwnership.validate.mockResolvedValue(
        categoryRow({ id: CATEGORY_ID }),
      );

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
