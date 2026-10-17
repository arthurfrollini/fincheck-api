import { mock, type MockProxy } from 'jest-mock-extended';
import { PinoLogger } from 'nestjs-pino';
import { Job, UnrecoverableError } from 'bullmq';

// Mock env to avoid validation errors during tests
jest.mock('@shared/config/env', () => ({
  env: {
    resendApiKey: 'test-resend-api-key',
    resendFromEmail: 'noreply@fincheck.test',
  },
}));

// Mock the Resend SDK before importing MailService
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn() },
  })),
}));

import { MailProcessor } from './mail.processor';
import { MailService } from './mail.service';
import {
  WELCOME_JOB_NAME,
  EMAIL_CHANGE_CONFIRMATION_JOB_NAME,
  DOWNGRADE_NOTIFICATION_JOB_NAME,
  SUBSCRIPTION_CANCELLED_JOB_NAME,
  EMAIL_RETRY_MAX_DELAY_MS,
} from './mail-job.types';

const makeJob = (name: string, data: object): Job => mock<Job>({ name, data });

describe('MailProcessor', () => {
  let mockMailService: MockProxy<MailService>;
  let mockLogger: MockProxy<PinoLogger>;
  let processor: MailProcessor;

  beforeEach(() => {
    mockMailService = mock<MailService>();
    mockMailService.sendWelcome.mockResolvedValue(undefined);
    mockMailService.sendEmailChangeConfirmation.mockResolvedValue(undefined);
    mockMailService.sendDowngradeNotification.mockResolvedValue(undefined);
    mockMailService.sendSubscriptionCancelled.mockResolvedValue(undefined);
    mockLogger = mock<PinoLogger>();
    processor = new MailProcessor(mockMailService, mockLogger);
  });

  it('fails a job with malformed data without retrying or sending', async () => {
    const job = makeJob(WELCOME_JOB_NAME, { to: 42 });

    await expect(processor.process(job)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(mockMailService.sendWelcome).not.toHaveBeenCalled();
  });

  it('calls sendWelcome for a welcome job', async () => {
    const job = makeJob(WELCOME_JOB_NAME, {
      to: 'user@example.com',
      name: 'Arthur',
    });

    await processor.process(job);

    expect(mockMailService.sendWelcome).toHaveBeenCalledWith(
      'user@example.com',
      'Arthur',
    );
  });

  it('calls sendEmailChangeConfirmation for an email-change-confirmation job', async () => {
    const job = makeJob(EMAIL_CHANGE_CONFIRMATION_JOB_NAME, {
      to: 'user@example.com',
      token: 'tok-123',
    });

    await processor.process(job);

    expect(mockMailService.sendEmailChangeConfirmation).toHaveBeenCalledWith(
      'user@example.com',
      'tok-123',
    );
  });

  it('calls sendDowngradeNotification for a downgrade-notification job', async () => {
    const job = makeJob(DOWNGRADE_NOTIFICATION_JOB_NAME, {
      to: 'user@example.com',
      name: 'Arthur',
      newPlan: 'GOLD',
    });

    await processor.process(job);

    expect(mockMailService.sendDowngradeNotification).toHaveBeenCalledWith(
      'user@example.com',
      'Arthur',
      'GOLD',
    );
  });

  it('calls sendSubscriptionCancelled for a subscription-cancelled job', async () => {
    const job = makeJob(SUBSCRIPTION_CANCELLED_JOB_NAME, {
      to: 'user@example.com',
      name: 'Arthur',
    });

    await processor.process(job);

    expect(mockMailService.sendSubscriptionCancelled).toHaveBeenCalledWith(
      'user@example.com',
      'Arthur',
    );
  });

  it('throws on an unrecognized job name (lets BullMQ mark it failed)', async () => {
    const job = makeJob('unknown-job', {});

    await expect(processor.process(job)).rejects.toThrow(
      'Unknown mail job name: unknown-job',
    );
  });

  it('does not catch a MailService failure — lets it propagate for BullMQ to retry', async () => {
    mockMailService.sendWelcome.mockRejectedValueOnce(
      new Error('Resend unreachable'),
    );
    const job = makeJob(WELCOME_JOB_NAME, {
      to: 'user@example.com',
      name: 'Arthur',
    });

    await expect(processor.process(job)).rejects.toThrow('Resend unreachable');
  });

  describe('email-retry backoff strategy', () => {
    it('doubles the delay starting at 1000ms', () => {
      expect(MailProcessor.emailRetryBackoffStrategy(1)).toBe(1000);
      expect(MailProcessor.emailRetryBackoffStrategy(2)).toBe(2000);
      expect(MailProcessor.emailRetryBackoffStrategy(3)).toBe(4000);
    });

    it('caps at 30 minutes', () => {
      expect(MailProcessor.emailRetryBackoffStrategy(20)).toBe(
        EMAIL_RETRY_MAX_DELAY_MS,
      );
    });
  });
});
