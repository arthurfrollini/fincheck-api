import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePlanDto {
  @ApiProperty({
    description: 'Plan to change to',
    enum: ['GOLD', 'PLATINUM', 'FREE'],
  })
  @IsIn(['GOLD', 'PLATINUM', 'FREE'])
  planId: 'GOLD' | 'PLATINUM' | 'FREE';
}
