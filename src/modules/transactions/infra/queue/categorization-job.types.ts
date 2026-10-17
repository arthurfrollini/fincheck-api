import { z } from 'zod';

export const CATEGORIZATION_QUEUE_NAME = 'categorization';
export const CATEGORIZE_TRANSACTION_JOB_NAME = 'categorize-transaction';
// 2s, 4s, 8s, 16s between the 5 attempts: about 30s of retrying, enough to
// ride out a rate limit or a short API outage.
export const CATEGORIZATION_MAX_ATTEMPTS = 5;
export const CATEGORIZATION_BACKOFF_DELAY_MS = 2000;
// Same reasoning as the mail queue: completed jobs are noise after a day,
// failed ones are kept a week for inspection in RedisInsight.
export const COMPLETED_JOB_RETENTION_SECONDS = 24 * 60 * 60;
export const FAILED_JOB_RETENTION_SECONDS = 7 * 24 * 60 * 60;

export const categorizeTransactionJobData = z.object({
  userId: z.string(),
  transactionId: z.string(),
});
export type CategorizeTransactionJobData = z.infer<
  typeof categorizeTransactionJobData
>;
