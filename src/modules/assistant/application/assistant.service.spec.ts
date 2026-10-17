import { mock, type MockProxy } from 'jest-mock-extended';
import { PlanGuardService } from '@shared/plan/plan-guard.service';
import { type AgentRun } from '../entities/AgentRun';
import { AgentRunsRepository } from '../domain/repositories/agent-runs.repository';
import { AgentQueueService } from '../infra/queue/agent-queue.service';
import { ForbiddenException } from '@nestjs/common';
import { AssistantService } from './assistant.service';

const run = (id: string): AgentRun => ({
  id,
  userId: 'u1',
  idempotencyKey: 'k',
  question: 'q',
  status: 'QUEUED',
  answer: null,
  steps: 0,
});

describe('AssistantService.ask', () => {
  let repo: MockProxy<AgentRunsRepository>;
  let queue: MockProxy<AgentQueueService>;
  let planGuard: MockProxy<PlanGuardService>;
  let service: AssistantService;

  beforeEach(() => {
    repo = mock<AgentRunsRepository>();
    repo.findByIdempotencyKey.mockResolvedValue(null);
    repo.register.mockResolvedValue({ run: run('r1'), created: true });
    queue = mock<AgentQueueService>();
    planGuard = mock<PlanGuardService>();
    planGuard.validateGlobalAiBudget.mockResolvedValue(undefined);
    planGuard.validateDailyAiQuota.mockResolvedValue(undefined);
    service = new AssistantService(repo, queue, planGuard);
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
