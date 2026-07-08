import { type CategoryEntity } from '../../entities/Category';

export abstract class CategoriesRepository {
  abstract findAllByUserId(userId: string): Promise<CategoryEntity[]>;
  abstract findFirst(
    id: string,
    userId: string,
  ): Promise<CategoryEntity | null>;
}
