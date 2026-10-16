import { promoteToAdmin } from './promote-admin';

describe('promoteToAdmin', () => {
  it('sets role and plan to ADMINISTRATOR for the user with that email', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u1' }),
        update: jest.fn().mockResolvedValue({ id: 'u1' }),
      },
    };

    await expect(
      promoteToAdmin(prisma as never, '  owner@example.com '),
    ).resolves.toEqual({ id: 'u1' });
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
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    };

    await expect(
      promoteToAdmin(prisma as never, 'nobody@example.com'),
    ).rejects.toThrow(/nobody@example.com/);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
