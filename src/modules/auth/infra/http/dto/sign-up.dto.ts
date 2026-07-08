import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class SignUpDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsIn(['FREE', 'GOLD', 'PLATINUM'])
  plan?: 'FREE' | 'GOLD' | 'PLATINUM';

  @IsOptional()
  @IsString()
  paymentMethodId?: string;
}
