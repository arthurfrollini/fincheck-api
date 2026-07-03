import { Module } from '@nestjs/common';
import { CategoriesController } from './infra/http/categories.controller';
import { CategoriesService } from './application/categories.service';
import { CategoriesRepository } from './domain/repositories/categories.repository';
import { CategoriesPrismaRepository } from './infra/database/categories.prisma.repository';

@Module({
  controllers: [CategoriesController],
  providers: [
    CategoriesService,
    {
      provide: CategoriesRepository,
      useClass: CategoriesPrismaRepository,
    },
  ],
})
export class CategoriesModule {}
