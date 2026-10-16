export type AgentRunStatus =
  'QUEUED' | 'RUNNING' | 'COMPLETED' | 'DEGRADED' | 'FAILED';

export interface AgentRun {
  id: string;
  userId: string;
  idempotencyKey: string | null;
  question: string;
  status: AgentRunStatus;
  answer: string | null;
  steps: number;
}

export type FinishedStatus = Extract<
  AgentRunStatus,
  'COMPLETED' | 'DEGRADED' | 'FAILED'
>;
