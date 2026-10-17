import { z } from 'zod';
import { mock, type MockProxy } from 'jest-mock-extended';
import { PinoLogger } from 'nestjs-pino';
import { Job, Queue } from 'bullmq';
import { MailQueueService } from './mail-queue.service';
import {
  WELCOME_JOB_NAME,
  EMAIL_CHANGE_CONFIRMATION_JOB_NAME,
  DOWNGRADE_NOTIFICATION_JOB_NAME,
  SUBSCRIPTION_CANCELLED_JOB_NAME,
  EMAIL_RETRY_BACKOFF_TYPE,
  EMAIL_RETRY_MAX_ATTEMPTS,
  COMPLETED_JOB_RETENTION_SECONDS,
  FAILED_JOB_RETENTION_SECONDS,
} from './mail-job.types';
import { nthCall } from '../../../test/helpers/must';

const EXPECTED_JOB_OPTIONS = {
  attempts: EMAIL_RETRY_MAX_ATTEMPTS,
  backoff: { type: EMAIL_RETRY_BACKOFF_TYPE },
  removeOnComplete: { age: COMPLETED_JOB_RETENTION_SECONDS },
  removeOnFail: { age: FAILED_JOB_RETENTION_SECONDS },
};

describe('MailQueueService', () => {
  let mockQueue: MockProxy<Queue>;
  let mockLogger: MockProxy<PinoLogger>;
  let service: MailQueueService;

  beforeEach(() => {
    mockQueue = mock<Queue>();
    mockQueue.add.mockResolvedValue(mock<Job>());
    mockLogger = mock<PinoLogger>();
    service = new MailQueueService(mockQueue, mockLogger);
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

  it('enqueues a downgrade-notification job with the retry config', async () => {
    await service.queueDowngradeNotification(
      'user@example.com',
      'Arthur',
      'GOLD',
    );

    expect(mockQueue.add).toHaveBeenCalledWith(
      DOWNGRADE_NOTIFICATION_JOB_NAME,
      { to: 'user@example.com', name: 'Arthur', newPlan: 'GOLD' },
      EXPECTED_JOB_OPTIONS,
    );
  });

  it('enqueues a subscription-cancelled job with the retry config', async () => {
    await service.queueSubscriptionCancelled('user@example.com', 'Arthur');

    expect(mockQueue.add).toHaveBeenCalledWith(
      SUBSCRIPTION_CANCELLED_JOB_NAME,
      { to: 'user@example.com', name: 'Arthur' },
      EXPECTED_JOB_OPTIONS,
    );
  });

  it('catches and logs a queue.add failure instead of throwing', async () => {
    mockQueue.add.mockRejectedValueOnce(new Error('redis unreachable'));

    await expect(
      service.queueWelcome('user@example.com', 'Arthur'),
    ).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    const [rawPayload, rawMessage] = nthCall(mockLogger.error.mock);
    const logPayload = z
      .object({ err: z.unknown(), jobName: z.string() })
      .parse(rawPayload);
    const message = z.string().parse(rawMessage);
    expect(logPayload.jobName).toBe(WELCOME_JOB_NAME);
    expect(logPayload.err).toBeInstanceOf(Error);
    expect(message).toBe('Failed to enqueue mail job — email will not be sent');
  });
});
