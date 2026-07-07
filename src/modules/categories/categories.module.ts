import { Module } from '@nestjs/common';
import { CategoriesController } from './infra/http/categories.controller';
import { CategoriesService } from './application/categories.service';
import { CategoriesRepository } from './domain/repositories/categories.repository';
import { CategoriesPrismaRepository } from './infra/database/categories.prisma.repository';
import { ValidateCategoryOwnershipService } from './application/validate-category-ownership.service';

@Module({
  controllers: [CategoriesController],
  providers: [
    CategoriesService,
    ValidateCategoryOwnershipService,
    {
      provide: CategoriesRepository,
      useClass: CategoriesPrismaRepository,
    },
  ],
  exports: [ValidateCategoryOwnershipService],
})
export class CategoriesModule {}
