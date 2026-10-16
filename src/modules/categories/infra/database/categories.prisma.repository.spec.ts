import { CategoriesPrismaRepository } from './categories.prisma.repository';
import { PrismaService } from '@shared/database/prisma.service';

describe('CategoriesPrismaRepository', () => {
  let mockPrisma: { category: { findMany: jest.Mock } };
  let repository: CategoriesPrismaRepository;

  beforeEach(() => {
    mockPrisma = { category: { findMany: jest.fn().mockResolvedValue([]) } };
    repository = new CategoriesPrismaRepository(
      mockPrisma as unknown as PrismaService,
    );
  });

  it('findAllByUserIdAndType filters by userId and type', async () => {
    await repository.findAllByUserIdAndType('user-1', 'EXPENSE');

    expect(mockPrisma.category.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', type: 'EXPENSE' },
    });
  });
});
