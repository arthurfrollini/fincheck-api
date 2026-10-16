import Anthropic from '@anthropic-ai/sdk';
import { Job, UnrecoverableError } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { CategorizeTransactionService } from '../../application/categorize-transaction.service';
import { CategorizationProcessor } from './categorization.processor';

const job = {
  name: 'categorize-transaction',
  data: { userId: 'user-1', transactionId: 'tx-1' },
} as unknown as Job;

const headers = new Headers();

describe('CategorizationProcessor', () => {
  let categorize: jest.Mock;
  let processor: CategorizationProcessor;

  beforeEach(() => {
    categorize = jest.fn().mockResolvedValue('categorized');
    processor = new CategorizationProcessor(
      { categorize } as unknown as CategorizeTransactionService,
      { error: jest.fn() } as unknown as PinoLogger,
    );
  });

  it.each(['categorized', 'uncategorized', 'skipped', 'rejected', 'failed'])(
    'completes the job when the result is %s',
    async (result) => {
      categorize.mockResolvedValueOnce(result);

      await expect(processor.process(job)).resolves.toBeUndefined();
      expect(categorize).toHaveBeenCalledWith('user-1', 'tx-1');
    },
  );

  it.each([
    [
      'RateLimitError',
      new Anthropic.RateLimitError(429, undefined, 'x', headers),
    ],
    [
      'InternalServerError',
      new Anthropic.InternalServerError(529, undefined, 'x', headers),
    ],
    ['APIConnectionError', new Anthropic.APIConnectionError({ message: 'x' })],
    ['APIConnectionTimeoutError', new Anthropic.APIConnectionTimeoutError()],
    ['a non-SDK error', new Error('database connection lost')],
  ])('rethrows %s so BullMQ retries it', async (_name, error) => {
    categorize.mockRejectedValueOnce(error);

    await expect(processor.process(job)).rejects.toBe(error);
  });

  it.each([
    [
      'AuthenticationError',
      new Anthropic.AuthenticationError(401, undefined, 'x', headers),
    ],
    [
      'PermissionDeniedError',
      new Anthropic.PermissionDeniedError(403, undefined, 'x', headers),
    ],
    [
      'BadRequestError',
      new Anthropic.BadRequestError(400, undefined, 'x', headers),
    ],
    [
      'NotFoundError',
      new Anthropic.NotFoundError(404, undefined, 'x', headers),
    ],
  ])('fails %s without retrying', async (_name, error) => {
    categorize.mockRejectedValueOnce(error);

    await expect(processor.process(job)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});
