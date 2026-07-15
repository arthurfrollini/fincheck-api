import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { MailService } from './mail.service';
import {
  MAIL_QUEUE_NAME,
  WELCOME_JOB_NAME,
  EMAIL_CHANGE_CONFIRMATION_JOB_NAME,
  EMAIL_RETRY_BACKOFF_TYPE,
  EMAIL_RETRY_MAX_DELAY_MS,
  WelcomeJobData,
  EmailChangeConfirmationJobData,
} from './mail-job.types';

@Processor(MAIL_QUEUE_NAME, {
  drainDelay: 1,
  settings: {
    backoffStrategy: (attemptsMade: number, type?: string) => {
      if (type !== EMAIL_RETRY_BACKOFF_TYPE) {
        throw new Error(`Unknown backoff strategy type: ${type}`);
      }
      return MailProcessor.emailRetryBackoffStrategy(attemptsMade);
    },
  },
})
export class MailProcessor extends WorkerHost {
  static emailRetryBackoffStrategy(attemptsMade: number): number {
    const delay = 2 ** (attemptsMade - 1) * 1000;
    return Math.min(delay, EMAIL_RETRY_MAX_DELAY_MS);
  }

  constructor(
    private readonly mailService: MailService,
    @InjectPinoLogger(MailProcessor.name)
    private readonly logger: PinoLogger,
  ) {
    super();
  }

  // BullMQ's Worker re-emits underlying Redis connection errors (e.g. during
  // close()/teardown races) as an 'error' event. Without a listener, Node
  // treats it as an unhandled EventEmitter error and crashes the process —
  // see https://docs.bullmq.io/guide/going-to-production#log-errors.
  @OnWorkerEvent('error')
  onError(err: Error): void {
    this.logger.error({ err }, 'Mail worker connection error');
  }

  async process(job: Job): Promise<void> {
    if (job.name === WELCOME_JOB_NAME) {
      const { to, name } = job.data as WelcomeJobData;
      await this.mailService.sendWelcome(to, name);
      return;
    }

    if (job.name === EMAIL_CHANGE_CONFIRMATION_JOB_NAME) {
      const { to, token } = job.data as EmailChangeConfirmationJobData;
      await this.mailService.sendEmailChangeConfirmation(to, token);
      return;
    }

    throw new Error(`Unknown mail job name: ${job.name}`);
  }
}
