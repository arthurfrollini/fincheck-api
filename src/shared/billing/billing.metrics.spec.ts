import { type DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { BillingMetricsService } from './billing.metrics';
import { PrismaService } from '@shared/database/prisma.service';

describe('BillingMetricsService', () => {
  let mockPrisma: DeepMockProxy<PrismaService>;
  let service: BillingMetricsService;

  beforeEach(() => {
    mockPrisma = mockDeep<PrismaService>();
    mockPrisma.user.count.mockResolvedValue(0);
    service = new BillingMetricsService(mockPrisma);
  });

  it('counts users on GOLD or PLATINUM plans', async () => {
    mockPrisma.user.count.mockResolvedValueOnce(7);

    await expect(service.getActiveSubscriptionsCount()).resolves.toBe(7);
    expect(mockPrisma.user.count).toHaveBeenCalledWith({
      where: { plan: { in: ['GOLD', 'PLATINUM'] } },
    });
  });
});
