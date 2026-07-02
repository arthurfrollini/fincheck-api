import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class RequestEmailChangeDto {
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  newEmail: string;
}
