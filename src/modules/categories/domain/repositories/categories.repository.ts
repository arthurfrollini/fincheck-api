import { type Category } from '@prisma/client';

export abstract class CategoriesRepository {
  abstract findAllByUserId(userId: string): Promise<Category[]>;
}
