import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { StripeEventsRepository } from './stripe-events.repository';

@Injectable()
export class StripeEventsPrismaRepository implements StripeEventsRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async register(eventId: string, type: string): Promise<boolean> {
    try {
      await this.prismaService.processedStripeEvent.create({
        data: { eventId, type },
      });
      return true;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return false;
      }
      throw err;
    }
  }

  async unregister(eventId: string): Promise<void> {
    await this.prismaService.processedStripeEvent.delete({
      where: { eventId },
    });
  }

  async deleteOlderThan(date: Date): Promise<void> {
    await this.prismaService.processedStripeEvent.deleteMany({
      where: { processedAt: { lt: date } },
    });
  }
}
