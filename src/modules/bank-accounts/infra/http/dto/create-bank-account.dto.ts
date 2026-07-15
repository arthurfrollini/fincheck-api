import {
  IsEnum,
  IsHexColor,
  IsNotEmpty,
  IsNumber,
  IsString,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { BankAccountType } from '@modules/bank-accounts/entities/BankAccount';

export class CreateBankAccountDto {
  @ApiProperty({ description: 'Account name', example: 'Nubank' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Starting balance', example: 1000 })
  @IsNumber()
  @IsNotEmpty()
  initialBalance: number;

  @ApiProperty({ description: 'Account type', enum: BankAccountType })
  @IsEnum(BankAccountType)
  @IsNotEmpty()
  type: BankAccountType;

  @ApiProperty({ description: 'Hex color for UI display', example: '#8A05BE' })
  @IsString()
  @IsNotEmpty()
  @IsHexColor()
  color: string;
}
