import { TransactionType } from '@modules/transactions/entities/Transaction';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTransactionDto {
  @ApiProperty({ description: 'Bank account id', format: 'uuid' })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  bankAccountId: string;

  @ApiProperty({ description: 'Category id', format: 'uuid' })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  categoryId: string;

  @ApiProperty({ description: 'Transaction name', example: 'Groceries' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Transaction value, must be positive', example: 100 })
  @IsNumber()
  @IsNotEmpty()
  @IsPositive()
  value: number;

  @ApiProperty({ description: 'ISO date string', example: '2026-06-15' })
  @IsDateString()
  @IsNotEmpty()
  date: string;

  @ApiProperty({ description: 'Transaction type', enum: TransactionType })
  @IsNotEmpty()
  @IsEnum(TransactionType)
  type: TransactionType;
}
