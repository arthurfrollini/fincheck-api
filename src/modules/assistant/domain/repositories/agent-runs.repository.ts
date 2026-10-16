import { type AgentRun, type FinishedStatus } from '../../entities/AgentRun';

export abstract class AgentRunsRepository {
  // Register-first idempotency, like ProcessedStripeEvent: the unique
  // (userId, idempotencyKey) constraint decides, so concurrent duplicates
  // still yield one run.
  abstract register(
    userId: string,
    question: string,
    idempotencyKey?: string,
  ): Promise<{ run: AgentRun; created: boolean }>;
  abstract findForUser(userId: string, id: string): Promise<AgentRun | null>;
  abstract findByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<AgentRun | null>;
  abstract findById(id: string): Promise<AgentRun | null>;
  abstract markRunning(id: string): Promise<void>;
  abstract finish(
    id: string,
    result: { status: FinishedStatus; answer: string; steps: number },
  ): Promise<void>;
}
