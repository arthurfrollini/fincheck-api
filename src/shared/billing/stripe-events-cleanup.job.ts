import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StripeEventsRepository } from './stripe-events.repository';

// Stripe redelivers failed webhooks for up to ~3 days; 30 days of dedup
// history is a comfortable margin while keeping the table from growing
// forever (same class of concern as the Redis job-retention caps).
const RETENTION_DAYS = 30;

@Injectable()
export class StripeEventsCleanupJob {
  constructor(
    private readonly stripeEventsRepository: StripeEventsRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handle() {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await this.stripeEventsRepository.deleteOlderThan(cutoff);
  }
}
