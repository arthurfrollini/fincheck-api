import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { bullRootOptions } from '@shared/config/bullmq';
import { MailService } from './mail.service';
import { MailQueueService } from './mail-queue.service';
import { MailProcessor } from './mail.processor';
import { MAIL_QUEUE_NAME } from './mail-job.types';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({ useFactory: bullRootOptions }),
    BullModule.registerQueue({ name: MAIL_QUEUE_NAME }),
  ],
  providers: [MailService, MailQueueService, MailProcessor],
  exports: [MailService, MailQueueService],
})
export class MailModule {}
