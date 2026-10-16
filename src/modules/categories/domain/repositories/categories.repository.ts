import {
  type CategoryCreate,
  type CategoryEntity,
  type CategoryType,
  type CategoryUpdate,
} from '../../entities/Category';

export abstract class CategoriesRepository {
  abstract findAllByUserId(userId: string): Promise<CategoryEntity[]>;
  abstract findAllByUserIdAndType(
    userId: string,
    type: CategoryType,
  ): Promise<CategoryEntity[]>;
  abstract findFirst(
    id: string,
    userId: string,
  ): Promise<CategoryEntity | null>;
  abstract create(data: CategoryCreate): Promise<CategoryEntity>;
  abstract update(id: string, data: CategoryUpdate): Promise<CategoryEntity>;
  abstract delete(id: string): Promise<void>;
}
