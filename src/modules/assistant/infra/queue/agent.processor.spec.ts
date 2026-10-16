import Anthropic from '@anthropic-ai/sdk';
import { Job, UnrecoverableError } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { RunAgentService } from '../../application/run-agent.service';
import { AgentProcessor } from './agent.processor';

const job = (attemptsMade = 1, attempts = 3) =>
  ({
    name: 'run-agent',
    data: { runId: 'run-1' },
    attemptsMade,
    opts: { attempts },
  }) as unknown as Job;

describe('AgentProcessor', () => {
  let service: { run: jest.Mock; markFailed: jest.Mock };
  let processor: AgentProcessor;

  beforeEach(() => {
    service = {
      run: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    processor = new AgentProcessor(
      service as unknown as RunAgentService,
      { error: jest.fn() } as unknown as PinoLogger,
    );
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

  it('leaves the run alone while retries remain', async () => {
    await processor.onFailed(job(1, 3), new Error('blip'));
    expect(service.markFailed).not.toHaveBeenCalled();
  });
});
