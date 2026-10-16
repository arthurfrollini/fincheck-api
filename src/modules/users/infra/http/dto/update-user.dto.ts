import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Plan, Role } from '@modules/users/entities/User';

export class UpdateUserDto {
  @ApiPropertyOptional({ description: 'Full name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Email address' })
  @IsString()
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ description: 'Role', enum: Role })
  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  // How plans are assigned when self-service billing is off (production).
  @ApiPropertyOptional({ description: 'Plan', enum: Plan })
  @IsEnum(Plan)
  @IsOptional()
  plan?: Plan;
}
