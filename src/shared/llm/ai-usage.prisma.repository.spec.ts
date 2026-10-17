import { type DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaService } from '@shared/database/prisma.service';
import { AiUsagePrismaRepository } from './ai-usage.prisma.repository';

// mockDeep types aggregate() with every aggregate key; the repository only
// asks for _sum.costUsd, so the others are undefined.
function costSum(costUsd: number | null) {
  return {
    _count: undefined,
    _avg: undefined,
    _min: undefined,
    _max: undefined,
    _sum: { costUsd },
  };
}

describe('AiUsagePrismaRepository', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let repository: AiUsagePrismaRepository;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-16T21:30:00-03:00'));
    prisma = mockDeep<PrismaService>();
    prisma.aiUsage.count.mockResolvedValue(3);
    prisma.aiUsage.aggregate.mockResolvedValue(costSum(0.42));
    repository = new AiUsagePrismaRepository(prisma);
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
    expect(prisma.aiUsage.create).toHaveBeenCalledWith({
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
    expect(prisma.aiUsage.count).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        feature: 'rag',
        createdAt: { gte: startOfUtcDay },
      },
    });
  });

  it("sums today's spend across all users, 0 when there is none", async () => {
    await expect(repository.spendToday()).resolves.toBeCloseTo(0.42);
    expect(prisma.aiUsage.aggregate).toHaveBeenCalledWith({
      where: { createdAt: { gte: startOfUtcDay } },
      _sum: { costUsd: true },
    });
    prisma.aiUsage.aggregate.mockResolvedValueOnce(costSum(null));
    await expect(repository.spendToday()).resolves.toBe(0);
  });
});
