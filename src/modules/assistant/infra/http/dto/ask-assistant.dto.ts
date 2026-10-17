import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AskAssistantDto {
  @ApiProperty({
    description: 'A question about your own transactions, in Portuguese',
    example: 'Quanto gastei com alimentação em setembro?',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  question!: string;
}
