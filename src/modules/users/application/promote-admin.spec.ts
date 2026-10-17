import type { PrismaClient } from '@prisma/client';
import { mockDeep } from 'jest-mock-extended';
import { userRow } from '../../../../test/helpers/prisma-rows';
import { promoteToAdmin } from './promote-admin';

describe('promoteToAdmin', () => {
  it('sets role and plan to ADMINISTRATOR for the user with that email', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.user.findUnique.mockResolvedValue(userRow({ id: 'u1' }));
    prisma.user.update.mockResolvedValue(userRow({ id: 'u1' }));

    await expect(
      promoteToAdmin(prisma, '  owner@example.com '),
    ).resolves.toMatchObject({ id: 'u1' });
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
