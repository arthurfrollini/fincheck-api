import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';
import { CategoriesRepository } from '@modules/categories/domain/repositories/categories.repository';
import {
  type CategoryCreate,
  type CategoryEntity,
  type CategoryUpdate,
} from '@modules/categories/entities/Category';

@Injectable()
export class CategoriesPrismaRepository implements CategoriesRepository {
  constructor(private readonly prismaService: PrismaService) {}

  findAllByUserId(userId: string): Promise<CategoryEntity[]> {
    return this.prismaService.category.findMany({ where: { userId } });
  }

  findFirst(id: string, userId: string): Promise<CategoryEntity | null> {
    return this.prismaService.category.findFirst({ where: { id, userId } });
  }

  create(data: CategoryCreate): Promise<CategoryEntity> {
    return this.prismaService.category.create({ data });
  }

  update(id: string, data: CategoryUpdate): Promise<CategoryEntity> {
    return this.prismaService.category.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prismaService.category.delete({ where: { id } });
  }
}
