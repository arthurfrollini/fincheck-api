import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@modules/users/entities/User';

export class CreateUserDto {
  @ApiProperty({ description: 'Full name', example: 'New User' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Email address', example: 'new@example.com' })
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

  @ApiPropertyOptional({ description: 'Role — defaults to USER', enum: Role })
  @IsEnum(Role)
  @IsOptional()
  role?: Role;
}
