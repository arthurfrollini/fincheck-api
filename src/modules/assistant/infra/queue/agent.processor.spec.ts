import { mock, type MockProxy } from 'jest-mock-extended';
import Anthropic from '@anthropic-ai/sdk';
import { Job, UnrecoverableError } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { RunAgentService } from '../../application/run-agent.service';
import { AgentProcessor } from './agent.processor';

const job = (attemptsMade = 1, attempts = 3) =>
  mock<Job>({
    name: 'run-agent',
    data: { runId: 'run-1' },
    attemptsMade,
    opts: { attempts },
  });

describe('AgentProcessor', () => {
  let service: MockProxy<RunAgentService>;
  let processor: AgentProcessor;

  beforeEach(() => {
    service = mock<RunAgentService>();
    service.run.mockResolvedValue(undefined);
    service.markFailed.mockResolvedValue(undefined);
    processor = new AgentProcessor(service, mock<PinoLogger>());
  });

  it('runs the agent for the job run id', async () => {
    await processor.process(job());
    expect(service.run).toHaveBeenCalledWith('run-1');
  });

  it('rethrows transient errors for a retry', async () => {
    const error = new Anthropic.RateLimitError(
      429,
      undefined,
      'x',
      new Headers(),
    );
    service.run.mockRejectedValueOnce(error);
    await expect(processor.process(job())).rejects.toBe(error);
  });

  it('fails permanent errors without retrying', async () => {
    service.run.mockRejectedValueOnce(
      new Anthropic.AuthenticationError(401, undefined, 'x', new Headers()),
    );
    await expect(processor.process(job())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('marks the run FAILED when the last attempt fails, so polling clients get an answer', async () => {
    await processor.onFailed(job(3, 3), new Error('boom'));
    expect(service.markFailed).toHaveBeenCalledWith('run-1');
  });

  it('marks the run FAILED right away on an unrecoverable error', async () => {
    await processor.onFailed(job(1, 3), new UnrecoverableError('bad key'));
    expect(service.markFailed).toHaveBeenCalledWith('run-1');
  });

  it('never lets a failure inside the failed handler escape (it would be an unhandled rejection)', async () => {
    service.markFailed.mockRejectedValueOnce(new Error('db blip'));

    await expect(
      processor.onFailed(job(3, 3), new Error('boom')),
    ).resolves.toBeUndefined();
  });

  it('logs and returns when a failed job carries malformed data', async () => {
    const bad = mock<Job>({ data: {}, attemptsMade: 3, opts: { attempts: 3 } });

    await expect(
      processor.onFailed(bad, new Error('boom')),
    ).resolves.toBeUndefined();
    expect(service.markFailed).not.toHaveBeenCalled();
  });

  it('leaves the run alone while retries remain', async () => {
    await processor.onFailed(job(1, 3), new Error('blip'));
    expect(service.markFailed).not.toHaveBeenCalled();
  });
});
