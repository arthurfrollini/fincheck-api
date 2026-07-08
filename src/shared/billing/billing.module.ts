import { Global, Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingWebhookHandler } from './billing.webhook';
import { BillingController } from './billing.controller';

@Global()
@Module({
  controllers: [BillingController],
  providers: [BillingService, BillingWebhookHandler],
  exports: [BillingService],
})
export class BillingModule {}
