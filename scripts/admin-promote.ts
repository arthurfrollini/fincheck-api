// Makes an existing account ADMINISTRATOR (role and plan). Run once against
// a new environment, then manage plans through PATCH /users/:id.
//
//   npm run admin:promote -- owner@example.com
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { promoteToAdmin } from '../src/modules/users/application/promote-admin';

dotenv.config();

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) throw new Error('Usage: npm run admin:promote -- <email>');
  const prisma = new PrismaClient();
  try {
    const { id } = await promoteToAdmin(prisma, email);
    console.log(`${email.trim()} is now ADMINISTRATOR (user ${id}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
