import { Injectable, NotFoundException } from '@nestjs/common';
import { PlanGuardService } from '@shared/plan/plan-guard.service';
import { AgentRunsRepository } from '../domain/repositories/agent-runs.repository';
import { type AgentRun } from '../entities/AgentRun';
import { AgentQueueService } from '../infra/queue/agent-queue.service';

@Injectable()
export class AssistantService {
  constructor(
    private readonly agentRunsRepository: AgentRunsRepository,
    private readonly agentQueueService: AgentQueueService,
    private readonly planGuardService: PlanGuardService,
  ) {}

  async ask(
    userId: string,
    question: string,
    idempotencyKey?: string,
  ): Promise<{ run: AgentRun; created: boolean }> {
    // A repeated key returns the original run before any check, so retrying
    // a request never spends quota (and never gets refused for it).
    if (idempotencyKey) {
      const existing = await this.agentRunsRepository.findByIdempotencyKey(
        userId,
        idempotencyKey,
      );
      if (existing) return { run: existing, created: false };
    }

    await this.planGuardService.validateGlobalAiBudget();
    await this.planGuardService.validateDailyAiQuota(userId, 'agent');

    const registered = await this.agentRunsRepository.register(
      userId,
      question,
      idempotencyKey,
    );
    // A repeated key returns the original run and starts nothing new.
    if (registered.created) {
      await this.agentQueueService.enqueue(registered.run.id);
    }
    return registered;
  }

  async findRun(userId: string, runId: string): Promise<AgentRun> {
    const run = await this.agentRunsRepository.findForUser(userId, runId);
    if (!run) throw new NotFoundException('Run not found.');
    return run;
  }
}
