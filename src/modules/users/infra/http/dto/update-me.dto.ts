import { IsOptional, IsString, IsNotEmpty, IsUrl } from 'class-validator';

export class UpdateMeDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @IsUrl()
  @IsOptional()
  avatarUrl?: string;
}
