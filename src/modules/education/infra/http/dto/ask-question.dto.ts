import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AskQuestionDto {
  @ApiProperty({
    description: 'A personal finance question, in Portuguese',
    example: 'Quanto eu deveria guardar todo mês?',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  question!: string;
}
