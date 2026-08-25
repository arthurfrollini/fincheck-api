import { BillingMetricsService } from './billing.metrics';
import { PrismaService } from '@shared/database/prisma.service';

describe('BillingMetricsService', () => {
  let mockPrisma: { user: { count: jest.Mock } };
  let service: BillingMetricsService;

  beforeEach(() => {
    mockPrisma = { user: { count: jest.fn().mockResolvedValue(0) } };
    service = new BillingMetricsService(
      mockPrisma as unknown as PrismaService,
    );
  });

  it('counts users on GOLD or PLATINUM plans', async () => {
    mockPrisma.user.count.mockResolvedValueOnce(7);

    await expect(service.getActiveSubscriptionsCount()).resolves.toBe(7);
    expect(mockPrisma.user.count).toHaveBeenCalledWith({
      where: { plan: { in: ['GOLD', 'PLATINUM'] } },
    });
  });
});
