import { Global, Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingWebhookHandler } from './billing.webhook';
import { BillingController } from './billing.controller';
import { UsersModule } from '@modules/users/users.module';

@Global()
@Module({
  imports: [UsersModule],
  controllers: [BillingController],
  providers: [BillingService, BillingWebhookHandler],
  exports: [BillingService],
})
export class BillingModule {}
