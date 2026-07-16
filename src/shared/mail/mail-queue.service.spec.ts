import { PinoLogger } from 'nestjs-pino';
import { Queue } from 'bullmq';
import { MailQueueService } from './mail-queue.service';
import {
  WELCOME_JOB_NAME,
  EMAIL_CHANGE_CONFIRMATION_JOB_NAME,
  EMAIL_RETRY_BACKOFF_TYPE,
  EMAIL_RETRY_MAX_ATTEMPTS,
  COMPLETED_JOB_RETENTION_SECONDS,
  FAILED_JOB_RETENTION_SECONDS,
} from './mail-job.types';

const EXPECTED_JOB_OPTIONS = {
  attempts: EMAIL_RETRY_MAX_ATTEMPTS,
  backoff: { type: EMAIL_RETRY_BACKOFF_TYPE },
  removeOnComplete: { age: COMPLETED_JOB_RETENTION_SECONDS },
  removeOnFail: { age: FAILED_JOB_RETENTION_SECONDS },
};

describe('MailQueueService', () => {
  let mockQueue: jest.Mocked<Pick<Queue, 'add' | 'on'>>;
  let mockLogger: jest.Mocked<Pick<PinoLogger, 'error'>>;
  let service: MailQueueService;

  beforeEach(() => {
    mockQueue = { add: jest.fn().mockResolvedValue(undefined), on: jest.fn() };
    mockLogger = { error: jest.fn() };
    service = new MailQueueService(
      mockQueue as unknown as Queue,
      mockLogger as unknown as PinoLogger,
    );
  });

  it('enqueues a welcome job with the retry config', async () => {
    await service.queueWelcome('user@example.com', 'Arthur');

    expect(mockQueue.add).toHaveBeenCalledWith(
      WELCOME_JOB_NAME,
      { to: 'user@example.com', name: 'Arthur' },
      EXPECTED_JOB_OPTIONS,
    );
  });

  it('enqueues an email-change-confirmation job with the retry config', async () => {
    await service.queueEmailChangeConfirmation('user@example.com', 'tok-123');

    expect(mockQueue.add).toHaveBeenCalledWith(
      EMAIL_CHANGE_CONFIRMATION_JOB_NAME,
      { to: 'user@example.com', token: 'tok-123' },
      EXPECTED_JOB_OPTIONS,
    );
  });

  it('catches and logs a queue.add failure instead of throwing', async () => {
    mockQueue.add.mockRejectedValueOnce(new Error('redis unreachable'));

    await expect(
      service.queueWelcome('user@example.com', 'Arthur'),
    ).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    const [logPayload, message] = mockLogger.error.mock.calls[0] as [
      { err: unknown; jobName: string },
      string,
    ];
    expect(logPayload.jobName).toBe(WELCOME_JOB_NAME);
    expect(logPayload.err).toBeInstanceOf(Error);
    expect(message).toBe('Failed to enqueue mail job — email will not be sent');
  });
});
