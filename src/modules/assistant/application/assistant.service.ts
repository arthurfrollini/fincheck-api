import { Injectable, NotFoundException } from '@nestjs/common';
import { AgentRunsRepository } from '../domain/repositories/agent-runs.repository';
import { type AgentRun } from '../entities/AgentRun';
import { AgentQueueService } from '../infra/queue/agent-queue.service';

@Injectable()
export class AssistantService {
  constructor(
    private readonly agentRunsRepository: AgentRunsRepository,
    private readonly agentQueueService: AgentQueueService,
  ) {}

  async ask(
    userId: string,
    question: string,
    idempotencyKey?: string,
  ): Promise<{ run: AgentRun; created: boolean }> {
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
