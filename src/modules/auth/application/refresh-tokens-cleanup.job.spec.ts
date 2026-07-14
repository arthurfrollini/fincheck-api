import { RefreshTokensCleanupJob } from './refresh-tokens-cleanup.job';

describe('RefreshTokensCleanupJob', () => {
  it('calls refreshTokensRepository.deleteExpired on handle()', async () => {
    const mockRepo = { deleteExpired: jest.fn().mockResolvedValue(undefined) };
    const job = new RefreshTokensCleanupJob(mockRepo as any);

    await job.handle();

    expect(mockRepo.deleteExpired).toHaveBeenCalledTimes(1);
  });
});
