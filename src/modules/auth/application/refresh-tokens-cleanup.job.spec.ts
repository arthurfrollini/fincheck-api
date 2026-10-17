import { mock } from 'jest-mock-extended';
import { RefreshTokensRepository } from '../domain/repositories/refresh-tokens.repository';
import { RefreshTokensCleanupJob } from './refresh-tokens-cleanup.job';

describe('RefreshTokensCleanupJob', () => {
  it('calls refreshTokensRepository.deleteExpired on handle()', async () => {
    const mockRepo = mock<RefreshTokensRepository>();
    mockRepo.deleteExpired.mockResolvedValue(undefined);
    const job = new RefreshTokensCleanupJob(mockRepo);

    await job.handle();

    expect(mockRepo.deleteExpired).toHaveBeenCalledTimes(1);
  });
});
