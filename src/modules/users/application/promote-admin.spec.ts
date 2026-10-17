import type { PrismaClient } from '@prisma/client';
import { mockDeep } from 'jest-mock-extended';
import { userRow } from '../../../../test/helpers/prisma-rows';
import { promoteToAdmin } from './promote-admin';

describe('promoteToAdmin', () => {
  it('sets role and plan to ADMINISTRATOR for the user with that email', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.user.findUnique.mockResolvedValue(userRow({ id: 'u1' }));
    const updated = userRow({ id: 'u1', role: 'ADMINISTRATOR' });
    prisma.user.update.mockResolvedValue(updated);

    // Returns what update() selected, not the row it looked up.
    await expect(promoteToAdmin(prisma, '  owner@example.com ')).resolves.toBe(
      updated,
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'owner@example.com' },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: 'ADMINISTRATOR', plan: 'ADMINISTRATOR' },
      select: { id: true },
    });
  });

  it('refuses an email that has no account', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(promoteToAdmin(prisma, 'nobody@example.com')).rejects.toThrow(
      /nobody@example.com/,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
