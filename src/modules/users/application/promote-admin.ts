import { type PrismaClient } from '@prisma/client';

// Bootstraps the first admin on a fresh production database, where nobody
// can call the admin API yet. Emails are stored as typed at signup, so this
// only trims.
export async function promoteToAdmin(
  prisma: Pick<PrismaClient, 'user'>,
  email: string,
): Promise<{ id: string }> {
  const normalized = email.trim();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) {
    throw new Error(`No account with email ${normalized}. Sign up first.`);
  }
  return prisma.user.update({
    where: { id: user.id },
    data: { role: 'ADMINISTRATOR', plan: 'ADMINISTRATOR' },
    select: { id: true },
  });
}
