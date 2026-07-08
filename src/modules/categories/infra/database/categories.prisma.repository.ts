import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';
import { CategoriesRepository } from '@modules/categories/domain/repositories/categories.repository';
import { type CategoryEntity } from '@modules/categories/entities/Category';

@Injectable()
export class CategoriesPrismaRepository implements CategoriesRepository {
  constructor(private readonly prismaService: PrismaService) {}

  findAllByUserId(userId: string): Promise<CategoryEntity[]> {
    return this.prismaService.category.findMany({ where: { userId } });
  }

  findFirst(id: string, userId: string): Promise<CategoryEntity | null> {
    return this.prismaService.category.findFirst({ where: { id, userId } });
  }
}
