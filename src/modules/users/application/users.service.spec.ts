jest.mock('uuid', () => ({ v4: jest.fn().mockReturnValue('test-uuid') }));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));

jest.mock('@shared/config/env', () => ({
  env: {
    jwtSecret: 'test',
    jwtExpiresIn: '15m',
    stripeSecretKey: 'sk_test_fake',
    stripePriceGold: 'price_gold',
    stripePricePlatinum: 'price_platinum',
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { hash } from 'bcryptjs';
import { UsersService } from './users.service';
import { UsersRepository } from '../domain/repositories/users.repository';
import { MailService } from '@shared/mail/mail.service';
import { StorageService } from '@shared/storage/storage.service';
import { Plan, Role, UserEntity } from '../entities/User';

const makeUser = (overrides: Partial<UserEntity> = {}): UserEntity => ({
  id: 'user-1',
  name: 'Arthur',
  email: 'arthur@example.com',
  password: 'hashed',
  role: Role.USER,
  plan: Plan.FREE,
  googleId: null,
  avatarUrl: null,
  pendingEmail: null,
  emailToken: null,
  emailTokenExpiresAt: null,
  stripeCustomerId: null,
  stripePriceId: null,
  ...overrides,
});

describe('UsersService', () => {
  let service: UsersService;
  let mockUsersRepository: jest.Mocked<{
    findById: jest.Mock;
    findByEmail: jest.Mock;
    findByEmailToken: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  }>;
  let mockMailService: { sendEmailChangeConfirmation: jest.Mock };

  beforeEach(async () => {
    mockUsersRepository = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findByEmailToken: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockMailService = { sendEmailChangeConfirmation: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: mockUsersRepository },
        { provide: MailService, useValue: mockMailService },
        {
          provide: StorageService,
          useValue: { generateUploadUrl: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getUserById', () => {
    it('returns null when user not found', async () => {
      mockUsersRepository.findById.mockResolvedValue(null);
      const result = await service.getUserById('user-1');
      expect(result).toBeNull();
    });

    it('returns user fields without password', async () => {
      const user = makeUser();
      mockUsersRepository.findById.mockResolvedValue(user);

      const result = await service.getUserById('user-1');

      expect(result).toEqual({
        name: user.name,
        email: user.email,
        role: user.role,
        plan: user.plan,
        avatarUrl: user.avatarUrl,
      });
      expect(result).not.toHaveProperty('password');
    });
  });

  describe('listAll', () => {
    it('returns users without password or other sensitive fields', async () => {
      const users = [
        makeUser({ id: 'user-1' }),
        makeUser({ id: 'user-2', email: 'other@example.com' }),
      ];
      mockUsersRepository.findMany.mockResolvedValue(users);

      const result = await service.listAll();

      expect(mockUsersRepository.findMany).toHaveBeenCalled();
      expect(result).toEqual([
        {
          id: 'user-1',
          name: users[0].name,
          email: users[0].email,
          role: users[0].role,
          plan: users[0].plan,
          avatarUrl: users[0].avatarUrl,
        },
        {
          id: 'user-2',
          name: users[1].name,
          email: users[1].email,
          role: users[1].role,
          plan: users[1].plan,
          avatarUrl: users[1].avatarUrl,
        },
      ]);
      result.forEach((user) => expect(user).not.toHaveProperty('password'));
    });
  });

  describe('createByAdmin', () => {
    it('hashes the password and returns the created user without it', async () => {
      const created = makeUser({ id: 'user-2', email: 'new@example.com' });
      mockUsersRepository.create.mockResolvedValue(created);

      const dto = {
        name: 'New User',
        email: 'new@example.com',
        password: 'plaintext-password',
        role: Role.USER,
      };

      const result = await service.createByAdmin(dto);

      expect(hash).toHaveBeenCalledWith('plaintext-password', 12);
      expect(mockUsersRepository.create).toHaveBeenCalledWith({
        name: 'New User',
        email: 'new@example.com',
        password: 'hashed-password',
        role: Role.USER,
      });
      expect(result).toEqual({
        id: created.id,
        name: created.name,
        email: created.email,
        role: created.role,
        plan: created.plan,
        avatarUrl: created.avatarUrl,
      });
      expect(result).not.toHaveProperty('password');
    });
  });

  describe('update', () => {
    it('throws NotFoundException when user not found', async () => {
      mockUsersRepository.findById.mockResolvedValue(null);

      await expect(
        service.update('user-1', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockUsersRepository.update).not.toHaveBeenCalled();
    });

    it('returns updated user fields without password on success', async () => {
      const user = makeUser();
      const updated = makeUser({ name: 'Updated Name', role: Role.USER });
      mockUsersRepository.findById.mockResolvedValue(user);
      mockUsersRepository.update.mockResolvedValue(updated);

      const result = await service.update('user-1', {
        name: 'Updated Name',
        email: 'updated@example.com',
        role: Role.USER,
      });

      expect(mockUsersRepository.update).toHaveBeenCalledWith('user-1', {
        name: 'Updated Name',
        email: 'updated@example.com',
        role: Role.USER,
      });
      expect(result).toEqual({
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role,
        plan: updated.plan,
        avatarUrl: updated.avatarUrl,
      });
      expect(result).not.toHaveProperty('password');
    });
  });

  describe('updateMe', () => {
    it('throws NotFoundException when user not found', async () => {
      mockUsersRepository.findById.mockResolvedValue(null);

      await expect(
        service.updateMe('user-1', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns updated user fields on success', async () => {
      const user = makeUser();
      const updated = makeUser({ name: 'New Name' });
      mockUsersRepository.findById.mockResolvedValue(user);
      mockUsersRepository.update.mockResolvedValue(updated);

      const result = await service.updateMe('user-1', { name: 'New Name' });

      expect(mockUsersRepository.update).toHaveBeenCalledWith('user-1', {
        name: 'New Name',
        avatarUrl: undefined,
      });
      expect(result).toEqual({
        name: updated.name,
        email: updated.email,
        role: updated.role,
        plan: updated.plan,
        avatarUrl: updated.avatarUrl,
      });
    });
  });

  describe('delete', () => {
    it('throws NotFoundException when user not found', async () => {
      mockUsersRepository.findById.mockResolvedValue(null);

      await expect(service.delete('user-1')).rejects.toThrow(NotFoundException);
      expect(mockUsersRepository.delete).not.toHaveBeenCalled();
    });

    it('calls usersRepository.delete on success', async () => {
      mockUsersRepository.findById.mockResolvedValue(makeUser());
      mockUsersRepository.delete.mockResolvedValue(undefined);

      await service.delete('user-1');

      expect(mockUsersRepository.delete).toHaveBeenCalledWith('user-1');
    });
  });

  describe('requestEmailChange', () => {
    it('throws ConflictException when new email already in use', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(makeUser());

      await expect(
        service.requestEmailChange('user-1', 'taken@example.com'),
      ).rejects.toThrow(ConflictException);
    });

    it('calls usersRepository.update with token and pendingEmail', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(null);
      mockUsersRepository.update.mockResolvedValue(makeUser());
      mockMailService.sendEmailChangeConfirmation.mockResolvedValue(undefined);

      await service.requestEmailChange('user-1', 'new@example.com');

      expect(mockUsersRepository.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          pendingEmail: 'new@example.com',
          emailToken: 'test-uuid',
          emailTokenExpiresAt: expect.any(Date),
        }),
      );
    });

    it('calls mailService.sendEmailChangeConfirmation with the token', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(null);
      mockUsersRepository.update.mockResolvedValue(makeUser());
      mockMailService.sendEmailChangeConfirmation.mockResolvedValue(undefined);

      await service.requestEmailChange('user-1', 'new@example.com');

      expect(mockMailService.sendEmailChangeConfirmation).toHaveBeenCalledWith(
        expect.any(String),
        'test-uuid',
      );
    });
  });

  describe('confirmEmailChange', () => {
    it('throws BadRequestException when token not found', async () => {
      mockUsersRepository.findByEmailToken.mockResolvedValue(null);

      await expect(service.confirmEmailChange('bad-token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when token is expired', async () => {
      const pastDate = new Date(Date.now() - 1000 * 60 * 60 * 2); // 2h ago
      const user = makeUser({
        pendingEmail: 'new@example.com',
        emailToken: 'some-token',
        emailTokenExpiresAt: pastDate,
      });
      mockUsersRepository.findByEmailToken.mockResolvedValue(user);

      await expect(service.confirmEmailChange('some-token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('updates email and clears pending fields on valid token', async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60);
      const user = makeUser({
        id: 'user-1',
        pendingEmail: 'new@example.com',
        emailToken: 'valid-token',
        emailTokenExpiresAt: futureDate,
      });
      mockUsersRepository.findByEmailToken.mockResolvedValue(user);
      mockUsersRepository.update.mockResolvedValue(makeUser());

      await service.confirmEmailChange('valid-token');

      expect(mockUsersRepository.update).toHaveBeenCalledWith('user-1', {
        email: 'new@example.com',
        pendingEmail: null,
        emailToken: null,
        emailTokenExpiresAt: null,
      });
    });
  });
});
