import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class AvatarUploadUrlDto {
  @ApiProperty({ enum: ['jpg', 'jpeg', 'png', 'webp'] })
  @IsIn(['jpg', 'jpeg', 'png', 'webp'])
  ext: string;
}
