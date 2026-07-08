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
