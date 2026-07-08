export const CategoryType = {
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
} as const;
export type CategoryType = (typeof CategoryType)[keyof typeof CategoryType];

export interface CategoryEntity {
  id: string;
  userId: string;
  name: string;
  icon: string;
  type: CategoryType;
}

export interface CategoryCreate {
  userId: string;
  name: string;
  icon: string;
  type: CategoryType;
}

export interface CategoryUpdate {
  name?: string;
  icon?: string;
}
