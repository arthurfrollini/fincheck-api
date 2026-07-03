import { Prisma, type Category } from '@prisma/client';

export abstract class CategoriesRepository {
  abstract findAllByUserId(
    findManyDto: Prisma.CategoryFindManyArgs,
  ): Promise<Category[]>;
}
