import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/shared/database/prisma.service';

export async function cleanDatabase(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);
  await prisma.$transaction([
    prisma.processedStripeEvent.deleteMany(),
    prisma.transaction.deleteMany(),
    prisma.category.deleteMany(),
    prisma.bankAccount.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}
