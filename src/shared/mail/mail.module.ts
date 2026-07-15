import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { env } from '@shared/config/env';
import { MailService } from './mail.service';
import { MailQueueService } from './mail-queue.service';
import { MAIL_QUEUE_NAME } from './mail-job.types';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: { host: env.redisHost, port: Number(env.redisPort) },
      }),
    }),
    BullModule.registerQueue({ name: MAIL_QUEUE_NAME }),
  ],
  providers: [MailService, MailQueueService],
  exports: [MailService, MailQueueService],
})
export class MailModule {}
