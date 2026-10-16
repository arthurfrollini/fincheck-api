import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import Anthropic from '@anthropic-ai/sdk';
import { Job, UnrecoverableError } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CategorizeTransactionService } from '../../application/categorize-transaction.service';
import {
  CATEGORIZATION_QUEUE_NAME,
  CategorizeTransactionJobData,
} from './categorization-job.types';

// 4xx means the request itself is wrong (bad key, bad params, no access) and
// will fail the same way every time, except these, which can clear up.
const TRANSIENT_CLIENT_STATUSES = new Set([408, 409, 429]);

function isPermanent(
  err: unknown,
): err is InstanceType<typeof Anthropic.AnthropicError> {
  // An SDK error with no HTTP status (e.g. a client-side output parsing
  // failure) will not change on retry.
  if (
    err instanceof Anthropic.AnthropicError &&
    !(err instanceof Anthropic.APIError)
  ) {
    return true;
  }
  return (
    err instanceof Anthropic.APIError &&
    !(err instanceof Anthropic.APIConnectionError) &&
    typeof err.status === 'number' &&
    err.status >= 400 &&
    err.status < 500 &&
    !TRANSIENT_CLIENT_STATUSES.has(err.status)
  );
}

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
      if (isPermanent(err)) {
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
