import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  MAIL_QUEUE_NAME,
  WELCOME_JOB_NAME,
  EMAIL_CHANGE_CONFIRMATION_JOB_NAME,
  EMAIL_RETRY_BACKOFF_TYPE,
  EMAIL_RETRY_MAX_ATTEMPTS,
  COMPLETED_JOB_RETENTION_SECONDS,
  FAILED_JOB_RETENTION_SECONDS,
  WelcomeJobData,
  EmailChangeConfirmationJobData,
} from './mail-job.types';

@Injectable()
export class MailQueueService {
  constructor(
    @InjectQueue(MAIL_QUEUE_NAME) private readonly mailQueue: Queue,
    @InjectPinoLogger(MailQueueService.name)
    private readonly logger: PinoLogger,
  ) {
    // BullMQ's Queue re-emits underlying Redis connection errors (e.g.
    // during close()/teardown races) as an 'error' event. Without a
    // listener, Node treats it as an unhandled EventEmitter error and
    // crashes the process — see
    // https://docs.bullmq.io/guide/going-to-production#log-errors.
    this.mailQueue.on('error', (err) => {
      this.logger.error({ err }, 'Mail queue connection error');
    });
  }

  async queueWelcome(to: string, name: string): Promise<void> {
    await this.enqueue<WelcomeJobData>(WELCOME_JOB_NAME, { to, name });
  }

  async queueEmailChangeConfirmation(to: string, token: string): Promise<void> {
    await this.enqueue<EmailChangeConfirmationJobData>(
      EMAIL_CHANGE_CONFIRMATION_JOB_NAME,
      { to, token },
    );
  }

  private async enqueue<T extends object>(
    jobName: string,
    data: T,
  ): Promise<void> {
    try {
      await this.mailQueue.add(jobName, data, {
        attempts: EMAIL_RETRY_MAX_ATTEMPTS,
        backoff: { type: EMAIL_RETRY_BACKOFF_TYPE },
        removeOnComplete: { age: COMPLETED_JOB_RETENTION_SECONDS },
        removeOnFail: { age: FAILED_JOB_RETENTION_SECONDS },
      });
    } catch (err) {
      this.logger.error(
        { err, jobName },
        'Failed to enqueue mail job — email will not be sent',
      );
    }
  }
}
