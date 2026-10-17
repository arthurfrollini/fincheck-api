import { type DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { Prisma } from '@prisma/client';
import { StripeEventsPrismaRepository } from './stripe-events.prisma.repository';
import { PrismaService } from '@shared/database/prisma.service';

const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
  code: 'P2002',
  clientVersion: '6.19.3',
});

describe('StripeEventsPrismaRepository', () => {
  let mockPrisma: DeepMockProxy<PrismaService>;
  let repository: StripeEventsPrismaRepository;

  beforeEach(() => {
    mockPrisma = mockDeep<PrismaService>();
    repository = new StripeEventsPrismaRepository(mockPrisma);
  });

  describe('register', () => {
    it('returns true when the event is new', async () => {
      await expect(
        repository.register('evt_1', 'customer.subscription.deleted'),
      ).resolves.toBe(true);
      expect(mockPrisma.processedStripeEvent.create).toHaveBeenCalledWith({
        data: { eventId: 'evt_1', type: 'customer.subscription.deleted' },
      });
    });

    it('returns false on a unique violation (P2002 — duplicate event)', async () => {
      mockPrisma.processedStripeEvent.create.mockRejectedValueOnce(p2002);
      await expect(repository.register('evt_1', 'x')).resolves.toBe(false);
    });

    it('rethrows any other error', async () => {
      mockPrisma.processedStripeEvent.create.mockRejectedValueOnce(
        new Error('db down'),
      );
      await expect(repository.register('evt_1', 'x')).rejects.toThrow(
        'db down',
      );
    });
  });

  it('unregister deletes by eventId', async () => {
    await repository.unregister('evt_1');
    expect(mockPrisma.processedStripeEvent.delete).toHaveBeenCalledWith({
      where: { eventId: 'evt_1' },
    });
  });

  it('deleteOlderThan prunes by processedAt', async () => {
    const cutoff = new Date('2026-06-16');
    await repository.deleteOlderThan(cutoff);
    expect(mockPrisma.processedStripeEvent.deleteMany).toHaveBeenCalledWith({
      where: { processedAt: { lt: cutoff } },
    });
  });
});
