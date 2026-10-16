import { TransactionsPrismaRepository } from './transactions.prisma.repository';
import { PrismaService } from '@shared/database/prisma.service';

describe('TransactionsPrismaRepository', () => {
  let mockPrisma: { transaction: { updateMany: jest.Mock } };
  let repository: TransactionsPrismaRepository;

  beforeEach(() => {
    mockPrisma = {
      transaction: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    repository = new TransactionsPrismaRepository(
      mockPrisma as unknown as PrismaService,
    );
  });

  describe('setCategoryIfUnset', () => {
    it('only writes when the transaction is still uncategorized', async () => {
      await repository.setCategoryIfUnset('tx-1', 'user-1', 'cat-1');

      expect(mockPrisma.transaction.updateMany).toHaveBeenCalledWith({
        where: { id: 'tx-1', userId: 'user-1', categoryId: null },
        data: { categoryId: 'cat-1' },
      });
    });

    it('returns true when a row changed', async () => {
      await expect(
        repository.setCategoryIfUnset('tx-1', 'user-1', 'cat-1'),
      ).resolves.toBe(true);
    });

    it('returns false when no row changed', async () => {
      mockPrisma.transaction.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        repository.setCategoryIfUnset('tx-1', 'user-1', 'cat-1'),
      ).resolves.toBe(false);
    });
  });
});
