import { type DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { CategoriesPrismaRepository } from './categories.prisma.repository';
import { PrismaService } from '@shared/database/prisma.service';

describe('CategoriesPrismaRepository', () => {
  let mockPrisma: DeepMockProxy<PrismaService>;
  let repository: CategoriesPrismaRepository;

  beforeEach(() => {
    mockPrisma = mockDeep<PrismaService>();
    mockPrisma.category.findMany.mockResolvedValue([]);
    repository = new CategoriesPrismaRepository(mockPrisma);
  });

  it('findAllByUserIdAndType filters by userId and type', async () => {
    await repository.findAllByUserIdAndType('user-1', 'EXPENSE');

    expect(mockPrisma.category.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', type: 'EXPENSE' },
    });
  });
});
