import { CategoriesRepository } from '@modules/categories/domain/repositories/categories.repository';
import { Injectable } from '@nestjs/common';
import { type Prisma, type Category } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';

@Injectable()
export class CategoriesPrismaRepository implements CategoriesRepository {
  constructor(private readonly prismaService: PrismaService) {}

  findAllByUserId(
    findManyDto: Prisma.CategoryFindManyArgs,
  ): Promise<Category[]> {
    return this.prismaService.category.findMany(findManyDto);
  }
}
