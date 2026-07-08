import { Injectable } from '@nestjs/common';
import { CategoriesRepository } from '../domain/repositories/categories.repository';
import { ValidateCategoryOwnershipService } from './validate-category-ownership.service';
import { PlanGuardService } from '@shared/plan/plan-guard.service';
import { CreateCategoryDto } from '../infra/http/dto/create-category.dto';
import { UpdateCategoryDto } from '../infra/http/dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly categoriesRepository: CategoriesRepository,
    private readonly validateCategoryOwnershipService: ValidateCategoryOwnershipService,
    private readonly planGuardService: PlanGuardService,
  ) {}

  findAllByUserId(userId: string) {
    return this.categoriesRepository.findAllByUserId(userId);
  }

  async create(userId: string, dto: CreateCategoryDto) {
    await this.planGuardService.validateCategoryAccess(userId);
    const { name, icon, type } = dto;
    return this.categoriesRepository.create({ userId, name, icon, type });
  }

  async update(userId: string, categoryId: string, dto: UpdateCategoryDto) {
    await Promise.all([
      this.planGuardService.validateCategoryAccess(userId),
      this.validateCategoryOwnershipService.validate(userId, categoryId),
    ]);
    const { name, icon } = dto;
    return this.categoriesRepository.update(categoryId, { name, icon });
  }

  async remove(userId: string, categoryId: string) {
    await Promise.all([
      this.planGuardService.validateCategoryAccess(userId),
      this.validateCategoryOwnershipService.validate(userId, categoryId),
    ]);
    await this.categoriesRepository.delete(categoryId);
  }
}
