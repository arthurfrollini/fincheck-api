import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  AGENT_BACKOFF_DELAY_MS,
  AGENT_MAX_ATTEMPTS,
  AGENT_QUEUE_NAME,
  COMPLETED_JOB_RETENTION_SECONDS,
  FAILED_JOB_RETENTION_SECONDS,
  RUN_AGENT_JOB_NAME,
  RunAgentJobData,
} from './agent-job.types';

@Injectable()
export class AgentQueueService {
  constructor(
    @InjectQueue(AGENT_QUEUE_NAME) private readonly agentQueue: Queue,
    @InjectPinoLogger(AgentQueueService.name)
    private readonly logger: PinoLogger,
  ) {
    // Same reason as the other queues: an unhandled 'error' event from the
    // Redis connection crashes the process.
    this.agentQueue.on('error', (err) => {
      this.logger.error({ err }, 'Agent queue connection error');
    });
  }

  // Never throws: the run row already exists, and a POST that 500s after
  // creating it would invite a retry that the idempotency key then hides.
  async enqueue(runId: string): Promise<void> {
    try {
      await this.agentQueue.add(
        RUN_AGENT_JOB_NAME,
        { runId } satisfies RunAgentJobData,
        {
          jobId: `agent-run-${runId}`,
          attempts: AGENT_MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: AGENT_BACKOFF_DELAY_MS },
          removeOnComplete: { age: COMPLETED_JOB_RETENTION_SECONDS },
          removeOnFail: { age: FAILED_JOB_RETENTION_SECONDS },
        },
      );
    } catch (err) {
      this.logger.error(
        { err, runId },
        'Failed to enqueue agent run — it stays QUEUED',
      );
    }
  }
}
