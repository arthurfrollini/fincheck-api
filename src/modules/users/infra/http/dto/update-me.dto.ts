import { IsOptional, IsString, IsNotEmpty, IsUrl } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateMeDto {
  @ApiPropertyOptional({ description: 'Full name' })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    description: 'Avatar URL, obtained from GET /users/me/avatar-upload-url',
  })
  @IsUrl()
  @IsOptional()
  avatarUrl?: string;
}
