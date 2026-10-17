import { mock, type MockProxy } from 'jest-mock-extended';
import { PinoLogger } from 'nestjs-pino';
import { Job, Queue } from 'bullmq';
import { CategorizationQueueService } from './categorization-queue.service';

describe('CategorizationQueueService', () => {
  let mockQueue: MockProxy<Queue>;
  let mockLogger: MockProxy<PinoLogger>;
  let service: CategorizationQueueService;

  beforeEach(() => {
    mockQueue = mock<Queue>();
    mockQueue.add.mockResolvedValue(mock<Job>());
    mockLogger = mock<PinoLogger>();
    service = new CategorizationQueueService(mockQueue, mockLogger);
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
