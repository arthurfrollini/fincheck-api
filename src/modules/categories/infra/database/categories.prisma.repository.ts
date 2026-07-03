import { Injectable } from '@nestjs/common';
import { type Category } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { CategoriesRepository } from '@modules/categories/domain/repositories/categories.repository';

@Injectable()
export class CategoriesPrismaRepository implements CategoriesRepository {
  constructor(private readonly prismaService: PrismaService) {}

  findAllByUserId(userId: string): Promise<Category[]> {
    return this.prismaService.category.findMany({ where: { userId } });
  }
}
