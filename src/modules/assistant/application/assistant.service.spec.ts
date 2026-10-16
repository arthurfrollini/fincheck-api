import { ForbiddenException } from '@nestjs/common';
import { AssistantService } from './assistant.service';

const run = (id: string) => ({
  id,
  userId: 'u1',
  idempotencyKey: 'k',
  question: 'q',
  status: 'QUEUED',
  answer: null,
  steps: 0,
});

describe('AssistantService.ask', () => {
  let repo: {
    findByIdempotencyKey: jest.Mock;
    register: jest.Mock;
    findForUser: jest.Mock;
  };
  let queue: { enqueue: jest.Mock };
  let planGuard: {
    validateGlobalAiBudget: jest.Mock;
    validateDailyAiQuota: jest.Mock;
  };
  let service: AssistantService;

  beforeEach(() => {
    repo = {
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
      register: jest.fn().mockResolvedValue({ run: run('r1'), created: true }),
      findForUser: jest.fn(),
    };
    queue = { enqueue: jest.fn() };
    planGuard = {
      validateGlobalAiBudget: jest.fn().mockResolvedValue(undefined),
      validateDailyAiQuota: jest.fn().mockResolvedValue(undefined),
    };
    service = new AssistantService(
      repo as never,
      queue as never,
      planGuard as never,
    );
  });

  it('checks budget and quota, then registers and enqueues a new run', async () => {
    await expect(service.ask('u1', 'q', 'k')).resolves.toEqual({
      run: run('r1'),
      created: true,
    });
    expect(planGuard.validateGlobalAiBudget).toHaveBeenCalled();
    expect(planGuard.validateDailyAiQuota).toHaveBeenCalledWith('u1', 'agent');
    expect(queue.enqueue).toHaveBeenCalledWith('r1');
  });

  it('returns the existing run for a repeated key before any quota check, so a retry never costs quota', async () => {
    repo.findByIdempotencyKey.mockResolvedValueOnce(run('r0'));
    planGuard.validateDailyAiQuota.mockRejectedValue(
      new ForbiddenException('quota'),
    );

    await expect(service.ask('u1', 'q', 'k')).resolves.toEqual({
      run: run('r0'),
      created: false,
    });
    expect(planGuard.validateDailyAiQuota).not.toHaveBeenCalled();
    expect(repo.register).not.toHaveBeenCalled();
  });

  it('creates no run when the quota refuses', async () => {
    planGuard.validateDailyAiQuota.mockRejectedValueOnce(
      new ForbiddenException('quota'),
    );

    await expect(service.ask('u1', 'q')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.register).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
