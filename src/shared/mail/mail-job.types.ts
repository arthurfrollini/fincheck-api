export const MAIL_QUEUE_NAME = 'mail';
export const WELCOME_JOB_NAME = 'welcome';
export const EMAIL_CHANGE_CONFIRMATION_JOB_NAME = 'email-change-confirmation';
export const EMAIL_RETRY_BACKOFF_TYPE = 'email-retry';
export const EMAIL_RETRY_MAX_ATTEMPTS = 60;
export const EMAIL_RETRY_MAX_DELAY_MS = 30 * 60 * 1000;
// BullMQ keeps every completed/failed job in Redis forever by default —
// unbounded memory growth (one job per signup/email-change). Completed jobs
// have no debugging value after a day; failed ones (already retried 60x over
// ~24h) are kept a week for manual inspection via RedisInsight.
export const COMPLETED_JOB_RETENTION_SECONDS = 24 * 60 * 60;
export const FAILED_JOB_RETENTION_SECONDS = 7 * 24 * 60 * 60;

export interface WelcomeJobData {
  to: string;
  name: string;
}

export interface EmailChangeConfirmationJobData {
  to: string;
  token: string;
}
