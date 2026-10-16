import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { isPermanentLlmError } from '@shared/llm/llm-errors';
import { CategorizeTransactionService } from '../../application/categorize-transaction.service';
import {
  CATEGORIZATION_QUEUE_NAME,
  CategorizeTransactionJobData,
} from './categorization-job.types';

// drainDelay: same e2e teardown-race mitigation as MailProcessor.
@Processor(CATEGORIZATION_QUEUE_NAME, { drainDelay: 1 })
export class CategorizationProcessor extends WorkerHost {
  constructor(
    private readonly categorizeTransactionService: CategorizeTransactionService,
    @InjectPinoLogger(CategorizationProcessor.name)
    private readonly logger: PinoLogger,
  ) {
    super();
  }

  @OnWorkerEvent('error')
  onError(err: Error): void {
    this.logger.error({ err }, 'Categorization worker connection error');
  }

  async process(job: Job): Promise<void> {
    const { userId, transactionId } = job.data as CategorizeTransactionJobData;
    try {
      await this.categorizeTransactionService.categorize(userId, transactionId);
    } catch (err) {
      if (isPermanentLlmError(err)) {
        this.logger.error(
          { err, transactionId },
          'Categorization failed permanently — not retrying',
        );
        throw new UnrecoverableError(err.message);
      }
      // Rate limits, 5xx, network errors and our own DB errors: let BullMQ
      // retry with backoff.
      throw err;
    }
  }
}
