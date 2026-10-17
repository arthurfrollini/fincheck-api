import { z } from 'zod';

export const AGENT_QUEUE_NAME = 'agent';
export const RUN_AGENT_JOB_NAME = 'run-agent';
// A retry restarts the run from the question (B1): fine for a read-only
// loop of seconds. 2s, 4s between attempts rides out a short rate limit.
export const AGENT_MAX_ATTEMPTS = 3;
export const AGENT_BACKOFF_DELAY_MS = 2000;
export const COMPLETED_JOB_RETENTION_SECONDS = 24 * 60 * 60;
export const FAILED_JOB_RETENTION_SECONDS = 7 * 24 * 60 * 60;

export const runAgentJobData = z.object({ runId: z.string() });
export type RunAgentJobData = z.infer<typeof runAgentJobData>;
