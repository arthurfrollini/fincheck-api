import { mock } from 'jest-mock-extended';
import { StripeEventsCleanupJob } from './stripe-events-cleanup.job';
import { StripeEventsRepository } from './stripe-events.repository';
import { nthCall } from '../../../test/helpers/must';

describe('StripeEventsCleanupJob', () => {
  it('deletes events older than 30 days', async () => {
    const mockRepository = mock<StripeEventsRepository>();
    const job = new StripeEventsCleanupJob(mockRepository);

    const before = Date.now();
    await job.handle();
    const after = Date.now();

    expect(mockRepository.deleteOlderThan).toHaveBeenCalledTimes(1);
    const [cutoff] = nthCall(mockRepository.deleteOlderThan.mock);
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - thirtyDaysMs);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after - thirtyDaysMs);
  });
});
