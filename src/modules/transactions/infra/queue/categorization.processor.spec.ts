import { mock, type MockProxy } from 'jest-mock-extended';
import Anthropic from '@anthropic-ai/sdk';
import { Job, UnrecoverableError } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import {
  CategorizeTransactionService,
  type CategorizationResult,
} from '../../application/categorize-transaction.service';
import { CategorizationProcessor } from './categorization.processor';

const job = mock<Job>({
  name: 'categorize-transaction',
  data: { userId: 'user-1', transactionId: 'tx-1' },
});

const headers = new Headers();

describe('CategorizationProcessor', () => {
  let service: MockProxy<CategorizeTransactionService>;
  let processor: CategorizationProcessor;

  beforeEach(() => {
    service = mock<CategorizeTransactionService>();
    service.categorize.mockResolvedValue('categorized');
    processor = new CategorizationProcessor(service, mock<PinoLogger>());
  });

  it('fails a job with malformed data without retrying or categorizing', async () => {
    await expect(
      processor.process(
        mock<Job>({ name: 'categorize-transaction', data: { userId: 'u' } }),
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(service.categorize).not.toHaveBeenCalled();
  });

  it.each<CategorizationResult>([
    'categorized',
    'uncategorized',
    'skipped',
    'rejected',
    'failed',
  ])('completes the job when the result is %s', async (result) => {
    service.categorize.mockResolvedValueOnce(result);

    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(service.categorize).toHaveBeenCalledWith('user-1', 'tx-1');
  });

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
    service.categorize.mockRejectedValueOnce(error);

    await expect(processor.process(job)).rejects.toBe(error);
  });

  it('fails a non-HTTP SDK error (e.g. output parsing) without retrying', async () => {
    service.categorize.mockRejectedValueOnce(
      new Anthropic.AnthropicError('bad output'),
    );

    await expect(processor.process(job)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
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
    service.categorize.mockRejectedValueOnce(error);

    await expect(processor.process(job)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});
