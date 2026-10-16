import { PrismaService } from '@shared/database/prisma.service';
import { AiUsagePrismaRepository } from './ai-usage.prisma.repository';

describe('AiUsagePrismaRepository', () => {
  let aiUsage: { create: jest.Mock; count: jest.Mock; aggregate: jest.Mock };
  let repository: AiUsagePrismaRepository;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-16T21:30:00-03:00'));
    aiUsage = {
      create: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(3),
      aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: 0.42 } }),
    };
    repository = new AiUsagePrismaRepository({
      aiUsage,
    } as unknown as PrismaService);
  });
  afterEach(() => jest.useRealTimers());

  const startOfUtcDay = new Date('2026-10-17T00:00:00.000Z');

  it('records one row per call', async () => {
    await repository.record({
      userId: 'u1',
      feature: 'rag',
      model: 'claude-sonnet-5-5',
      inputTokens: 2000,
      outputTokens: 200,
      costUsd: 0.006,
    });
    expect(aiUsage.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        feature: 'rag',
        model: 'claude-sonnet-5-5',
        inputTokens: 2000,
        outputTokens: 200,
        costUsd: 0.006,
      },
    });
  });

  it("counts a user's calls for a feature since the start of the UTC day", async () => {
    await expect(repository.countForUserToday('u1', 'rag')).resolves.toBe(3);
    expect(aiUsage.count).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        feature: 'rag',
        createdAt: { gte: startOfUtcDay },
      },
    });
  });

  it("sums today's spend across all users, 0 when there is none", async () => {
    await expect(repository.spendToday()).resolves.toBeCloseTo(0.42);
    expect(aiUsage.aggregate).toHaveBeenCalledWith({
      where: { createdAt: { gte: startOfUtcDay } },
      _sum: { costUsd: true },
    });
    aiUsage.aggregate.mockResolvedValueOnce({ _sum: { costUsd: null } });
    await expect(repository.spendToday()).resolves.toBe(0);
  });
});
