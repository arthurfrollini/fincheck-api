import { StripeEventsCleanupJob } from './stripe-events-cleanup.job';
import { StripeEventsRepository } from './stripe-events.repository';

describe('StripeEventsCleanupJob', () => {
  it('deletes events older than 30 days', async () => {
    const mockRepository = { deleteOlderThan: jest.fn() };
    const job = new StripeEventsCleanupJob(
      mockRepository as unknown as StripeEventsRepository,
    );

    const before = Date.now();
    await job.handle();
    const after = Date.now();

    expect(mockRepository.deleteOlderThan).toHaveBeenCalledTimes(1);
    const cutoff = mockRepository.deleteOlderThan.mock.calls[0][0] as Date;
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - thirtyDaysMs);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after - thirtyDaysMs);
  });
});
