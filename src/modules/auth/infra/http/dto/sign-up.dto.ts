import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SignUpDto {
  @ApiProperty({ description: 'Full name', example: 'Arthur Frollini' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Email address', example: 'arthur@example.com' })
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Password, minimum 8 characters',
    example: 'S3cur3Pass!',
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({
    description: 'Initial plan — defaults to FREE if omitted',
    enum: ['FREE', 'GOLD', 'PLATINUM'],
  })
  @IsOptional()
  @IsIn(['FREE', 'GOLD', 'PLATINUM'])
  plan?: 'FREE' | 'GOLD' | 'PLATINUM';

  @ApiPropertyOptional({
    description:
      'Stripe PaymentMethod id, required if plan is GOLD or PLATINUM',
    example: 'pm_1AbCdEfGhIjKlMnO',
  })
  @IsOptional()
  @IsString()
  paymentMethodId?: string;
}
