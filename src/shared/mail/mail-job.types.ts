export const MAIL_QUEUE_NAME = 'mail';
export const WELCOME_JOB_NAME = 'welcome';
export const EMAIL_CHANGE_CONFIRMATION_JOB_NAME = 'email-change-confirmation';
export const EMAIL_RETRY_BACKOFF_TYPE = 'email-retry';
export const EMAIL_RETRY_MAX_ATTEMPTS = 60;
export const EMAIL_RETRY_MAX_DELAY_MS = 30 * 60 * 1000;

export interface WelcomeJobData {
  to: string;
  name: string;
}

export interface EmailChangeConfirmationJobData {
  to: string;
  token: string;
}
