import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubscribeDto {
  @ApiProperty({
    description: 'Plan to subscribe to',
    enum: ['GOLD', 'PLATINUM'],
  })
  @IsIn(['GOLD', 'PLATINUM'])
  planId: 'GOLD' | 'PLATINUM';
}
