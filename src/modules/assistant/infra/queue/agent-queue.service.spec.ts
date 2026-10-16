import { PinoLogger } from 'nestjs-pino';
import { Queue } from 'bullmq';
import { AgentQueueService } from './agent-queue.service';

describe('AgentQueueService', () => {
  let queue: { add: jest.Mock; on: jest.Mock };
  let logger: { error: jest.Mock };
  let service: AgentQueueService;

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue(undefined), on: jest.fn() };
    logger = { error: jest.fn() };
    service = new AgentQueueService(
      queue as unknown as Queue,
      logger as unknown as PinoLogger,
    );
  });

  it('enqueues one deduplicated job per run with the retry config', async () => {
    await service.enqueue('run-1');
    expect(queue.add).toHaveBeenCalledWith(
      'run-agent',
      { runId: 'run-1' },
      {
        jobId: 'agent-run-run-1',
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 604800 },
      },
    );
  });

  it('logs instead of throwing when Redis is down', async () => {
    queue.add.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(service.enqueue('run-1')).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('registers a queue error listener', () => {
    expect(queue.on).toHaveBeenCalledWith('error', expect.any(Function));
  });
});
