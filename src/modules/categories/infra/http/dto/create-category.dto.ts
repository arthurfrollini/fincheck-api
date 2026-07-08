import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { CategoryType } from '@modules/categories/entities/Category';

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  icon: string;

  @IsEnum(CategoryType)
  type: CategoryType;
}
