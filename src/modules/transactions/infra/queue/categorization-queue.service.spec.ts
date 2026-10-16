import { PinoLogger } from 'nestjs-pino';
import { Queue } from 'bullmq';
import { CategorizationQueueService } from './categorization-queue.service';

describe('CategorizationQueueService', () => {
  let mockQueue: jest.Mocked<Pick<Queue, 'add' | 'on'>>;
  let mockLogger: jest.Mocked<Pick<PinoLogger, 'error'>>;
  let service: CategorizationQueueService;

  beforeEach(() => {
    mockQueue = { add: jest.fn().mockResolvedValue(undefined), on: jest.fn() };
    mockLogger = { error: jest.fn() };
    service = new CategorizationQueueService(
      mockQueue as unknown as Queue,
      mockLogger as unknown as PinoLogger,
    );
  });

  it('enqueues a deduplicated job with the retry config', async () => {
    await service.enqueue('user-1', 'tx-1');

    expect(mockQueue.add).toHaveBeenCalledWith(
      'categorize-transaction',
      { userId: 'user-1', transactionId: 'tx-1' },
      {
        jobId: 'categorize-tx-1',
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 604800 },
      },
    );
  });

  it('logs instead of throwing when Redis is down', async () => {
    mockQueue.add.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(service.enqueue('user-1', 'tx-1')).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('registers a queue error listener so Redis errors do not crash the process', () => {
    expect(mockQueue.on).toHaveBeenCalledWith('error', expect.any(Function));
  });
});
