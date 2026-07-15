import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CategoryType } from '@modules/categories/entities/Category';

export class CreateCategoryDto {
  @ApiProperty({ description: 'Category name', example: 'Groceries' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Icon identifier', example: 'shopping-cart' })
  @IsString()
  @IsNotEmpty()
  icon: string;

  @ApiProperty({ description: 'Category type', enum: CategoryType })
  @IsEnum(CategoryType)
  type: CategoryType;
}
