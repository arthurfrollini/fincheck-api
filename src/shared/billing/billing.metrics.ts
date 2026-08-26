import { Injectable, OnModuleInit } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { PrismaService } from '@shared/database/prisma.service';

@Injectable()
export class BillingMetricsService implements OnModuleInit {
  constructor(private readonly prismaService: PrismaService) {}

  async getActiveSubscriptionsCount(): Promise<number> {
    return this.prismaService.user.count({
      where: { plan: { in: ['GOLD', 'PLATINUM'] } },
    });
  }

  onModuleInit() {
    const meter = metrics.getMeter('fincheck-api');
    meter
      .createObservableGauge('fincheck_active_subscriptions', {
        description:
          'Number of users currently on a paid plan (GOLD or PLATINUM)',
      })
      .addCallback(async (result) => {
        result.observe(await this.getActiveSubscriptionsCount());
      });
  }
}
