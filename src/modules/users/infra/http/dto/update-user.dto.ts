import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { Role } from '@modules/users/entities/User';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsEnum(Role)
  @IsOptional()
  role?: Role;
}
