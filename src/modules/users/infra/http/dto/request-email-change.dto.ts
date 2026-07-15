import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestEmailChangeDto {
  @ApiProperty({ description: 'New email address', example: 'updated@example.com' })
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  newEmail: string;
}
