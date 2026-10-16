import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  CATEGORIZATION_BACKOFF_DELAY_MS,
  CATEGORIZATION_MAX_ATTEMPTS,
  CATEGORIZATION_QUEUE_NAME,
  CATEGORIZE_TRANSACTION_JOB_NAME,
  COMPLETED_JOB_RETENTION_SECONDS,
  FAILED_JOB_RETENTION_SECONDS,
  CategorizeTransactionJobData,
} from './categorization-job.types';

@Injectable()
export class CategorizationQueueService {
  constructor(
    @InjectQueue(CATEGORIZATION_QUEUE_NAME)
    private readonly categorizationQueue: Queue,
    @InjectPinoLogger(CategorizationQueueService.name)
    private readonly logger: PinoLogger,
  ) {
    // Same reason as MailQueueService: an unhandled 'error' event from the
    // Redis connection crashes the process.
    this.categorizationQueue.on('error', (err) => {
      this.logger.error({ err }, 'Categorization queue connection error');
    });
  }

  // Never throws: a transaction is saved whether or not it gets categorized.
  async enqueue(userId: string, transactionId: string): Promise<void> {
    try {
      await this.categorizationQueue.add(
        CATEGORIZE_TRANSACTION_JOB_NAME,
        { userId, transactionId } satisfies CategorizeTransactionJobData,
        {
          // Dedupes a double enqueue of the same transaction. No ':' in the
          // id, BullMQ uses it as its Redis key separator.
          jobId: `categorize-${transactionId}`,
          attempts: CATEGORIZATION_MAX_ATTEMPTS,
          backoff: {
            type: 'exponential',
            delay: CATEGORIZATION_BACKOFF_DELAY_MS,
          },
          removeOnComplete: { age: COMPLETED_JOB_RETENTION_SECONDS },
          removeOnFail: { age: FAILED_JOB_RETENTION_SECONDS },
        },
      );
    } catch (err) {
      this.logger.error(
        { err, transactionId },
        'Failed to enqueue categorization job — transaction stays uncategorized',
      );
    }
  }
}
