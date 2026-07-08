import { Global, Module } from '@nestjs/common';
import { PlanGuardService } from './plan-guard.service';

@Global()
@Module({
  providers: [PlanGuardService],
  exports: [PlanGuardService],
})
export class PlanModule {}
