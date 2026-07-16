import { Global, Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingWebhookHandler } from './billing.webhook';
import { BillingController } from './billing.controller';
import { StripeEventsRepository } from './stripe-events.repository';
import { StripeEventsPrismaRepository } from './stripe-events.prisma.repository';
import { StripeEventsCleanupJob } from './stripe-events-cleanup.job';
import { stripeProvider } from './stripe.provider';
import { UsersModule } from '@modules/users/users.module';

@Global()
@Module({
  imports: [UsersModule],
  controllers: [BillingController],
  providers: [
    stripeProvider,
    BillingService,
    BillingWebhookHandler,
    {
      provide: StripeEventsRepository,
      useClass: StripeEventsPrismaRepository,
    },
    StripeEventsCleanupJob,
  ],
  exports: [BillingService],
})
export class BillingModule {}
