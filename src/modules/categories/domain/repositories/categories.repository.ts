import { Prisma, type Category } from '@prisma/client';

export abstract class CategoriesRepository {
  abstract findAllByUserId(userId: string): Promise<Category[]>;
  abstract findFirst(
    args: Prisma.CategoryFindFirstArgs,
  ): Promise<Category | null>;
}
