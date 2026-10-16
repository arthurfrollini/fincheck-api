import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { isPermanentLlmError } from '@shared/llm/llm-errors';
import { RunAgentService } from '../../application/run-agent.service';
import { AGENT_QUEUE_NAME, RunAgentJobData } from './agent-job.types';

// drainDelay: same e2e teardown-race mitigation as the other processors.
@Processor(AGENT_QUEUE_NAME, { drainDelay: 1 })
export class AgentProcessor extends WorkerHost {
  constructor(
    private readonly runAgentService: RunAgentService,
    @InjectPinoLogger(AgentProcessor.name)
    private readonly logger: PinoLogger,
  ) {
    super();
  }

  @OnWorkerEvent('error')
  onError(err: Error): void {
    this.logger.error({ err }, 'Agent worker connection error');
  }

  // Once BullMQ gives up, the run must not stay RUNNING forever for a
  // client that is polling it.
  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error): Promise<void> {
    const outOfAttempts = job.attemptsMade >= (job.opts.attempts ?? 1);
    if (outOfAttempts || err instanceof UnrecoverableError) {
      const { runId } = job.data as RunAgentJobData;
      this.logger.error({ err, runId }, 'Agent run failed permanently');
      await this.runAgentService.markFailed(runId);
    }
  }

  async process(job: Job): Promise<void> {
    const { runId } = job.data as RunAgentJobData;
    try {
      await this.runAgentService.run(runId);
    } catch (err) {
      if (isPermanentLlmError(err)) throw new UnrecoverableError(err.message);
      throw err;
    }
  }
}
