jest.mock('uuid', () => ({ v4: jest.fn().mockReturnValue('test-uuid') }));
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  compare: jest.fn(),
}));
jest.mock('@shared/config/env', () => ({
  env: {
    jwtSecret: 'test-secret',
    databaseURL: 'postgresql://test',
    resendApiKey: 'test-key',
    resendFromEmail: 'test@test.com',
    googleClientId: 'google-id',
    googleClientSecret: 'google-secret',
    googleCallbackUrl: 'http://localhost/callback',
    awsRegion: 'us-east-1',
    awsAccessKeyId: 'aws-key',
    awsSecretAccessKey: 'aws-secret',
    awsS3BucketName: 'test-bucket',
    stripeSecretKey: 'sk_test_fake',
    stripeWebhookSecret: 'whsec_fake',
    stripePriceGold: 'price_gold',
    stripePricePlatinum: 'price_platinum',
  },
}));

import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { compare } from 'bcryptjs';
import { BillingService } from '@shared/billing/billing.service';
import { MailService } from '@shared/mail/mail.service';
import { RefreshTokensRepository } from '@modules/auth/domain/repositories/refresh-tokens.repository';
import { UsersRepository } from '@modules/users/domain/repositories/users.repository';
import { Plan, Role } from '@modules/users/entities/User';
import { AuthService } from './auth.service';

const mockCompare = compare as jest.Mock;

const mockUsersRepository = {
  findByEmail: jest.fn(),
  findByGoogleId: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

const mockRefreshTokensRepository = {
  findByToken: jest.fn(),
  create: jest.fn(),
  deleteByToken: jest.fn(),
};

const mockJwtService = {
  signAsync: jest.fn(),
};

const mockMailService = {
  sendWelcome: jest.fn(),
};

const mockBillingService = {
  createCustomerAndSubscribe: jest.fn(),
};

const baseUser = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  password: 'hashed-pw',
  role: Role.USER,
  plan: Plan.FREE,
  googleId: null,
  avatarUrl: null,
  pendingEmail: null,
  emailToken: null,
  emailTokenExpiresAt: null,
  stripeCustomerId: null,
  stripePriceId: null,
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockJwtService.signAsync.mockResolvedValue('access-token');
    mockRefreshTokensRepository.create.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersRepository, useValue: mockUsersRepository },
        {
          provide: RefreshTokensRepository,
          useValue: mockRefreshTokensRepository,
        },
        { provide: JwtService, useValue: mockJwtService },
        { provide: MailService, useValue: mockMailService },
        { provide: BillingService, useValue: mockBillingService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('signin', () => {
    it('throws UnauthorizedException when user not found', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(null);

      await expect(
        service.signin({ email: 'test@example.com', password: 'pw' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user has no password (Google-only account)', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue({
        ...baseUser,
        password: null,
      });

      await expect(
        service.signin({ email: 'test@example.com', password: 'pw' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when password is wrong', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(baseUser);
      mockCompare.mockResolvedValue(false);

      await expect(
        service.signin({ email: 'test@example.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns { accessToken, refreshToken } on valid credentials', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(baseUser);
      mockCompare.mockResolvedValue(true);

      const result = await service.signin({
        email: 'test@example.com',
        password: 'pw',
      });

      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'test-uuid',
      });
      expect(mockRefreshTokensRepository.create).toHaveBeenCalledWith(
        'user-1',
        'test-uuid',
        expect.any(Date),
      );
    });
  });

  describe('signup', () => {
    it('throws BadRequestException when plan is GOLD and no paymentMethodId', async () => {
      await expect(
        service.signup({
          name: 'Test',
          email: 'test@example.com',
          password: 'pw',
          plan: Plan.GOLD,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when email already taken', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(baseUser);

      await expect(
        service.signup({
          name: 'Test',
          email: 'test@example.com',
          password: 'pw',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates user, sends welcome email, returns tokens on FREE plan', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(null);
      mockUsersRepository.create.mockResolvedValue(baseUser);

      const result = await service.signup({
        name: 'Test',
        email: 'test@example.com',
        password: 'pw',
      });

      expect(mockUsersRepository.create).toHaveBeenCalled();
      expect(mockMailService.sendWelcome).toHaveBeenCalled();
      expect(
        mockBillingService.createCustomerAndSubscribe,
      ).not.toHaveBeenCalled();
      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'test-uuid',
      });
    });

    it('calls billingService.createCustomerAndSubscribe when plan is GOLD with paymentMethodId', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(null);
      mockUsersRepository.create.mockResolvedValue(baseUser);

      await service.signup({
        name: 'Test',
        email: 'test@example.com',
        password: 'pw',
        plan: Plan.GOLD,
        paymentMethodId: 'pm_123',
      });

      expect(
        mockBillingService.createCustomerAndSubscribe,
      ).toHaveBeenCalledWith('user-1', 'pm_123', Plan.GOLD);
    });
  });

  describe('refresh', () => {
    it('throws UnauthorizedException when token not found', async () => {
      mockRefreshTokensRepository.findByToken.mockResolvedValue(null);

      await expect(service.refresh('invalid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when token is expired and deletes it', async () => {
      mockRefreshTokensRepository.findByToken.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        token: 'expired-token',
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.refresh('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockRefreshTokensRepository.deleteByToken).toHaveBeenCalledWith(
        'expired-token',
      );
    });

    it('returns new tokens on valid refresh token', async () => {
      mockRefreshTokensRepository.findByToken.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        token: 'valid-token',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      mockUsersRepository.findById.mockResolvedValue(baseUser);

      const result = await service.refresh('valid-token');

      expect(mockRefreshTokensRepository.deleteByToken).toHaveBeenCalledWith(
        'valid-token',
      );
      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'test-uuid',
      });
    });
  });

  describe('signout', () => {
    it('calls refreshTokensRepository.deleteByToken with the token', async () => {
      await service.signout('some-token');

      expect(mockRefreshTokensRepository.deleteByToken).toHaveBeenCalledWith(
        'some-token',
      );
    });
  });

  describe('googleAuth', () => {
    const profile = {
      googleId: 'g-123',
      email: 'google@example.com',
      name: 'Google User',
    };

    it('returns tokens for existing Google user', async () => {
      mockUsersRepository.findByGoogleId.mockResolvedValue(baseUser);

      const result = await service.googleAuth(profile);

      expect(mockUsersRepository.findByEmail).not.toHaveBeenCalled();
      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'test-uuid',
      });
    });

    it('links Google ID to existing email user', async () => {
      const updatedUser = { ...baseUser, googleId: 'g-123' };
      mockUsersRepository.findByGoogleId.mockResolvedValue(null);
      mockUsersRepository.findByEmail.mockResolvedValue(baseUser);
      mockUsersRepository.update.mockResolvedValue(updatedUser);

      const result = await service.googleAuth(profile);

      expect(mockUsersRepository.update).toHaveBeenCalledWith('user-1', {
        googleId: 'g-123',
      });
      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'test-uuid',
      });
    });

    it('creates new user when neither Google ID nor email exist', async () => {
      const newUser = { ...baseUser, googleId: 'g-123' };
      mockUsersRepository.findByGoogleId.mockResolvedValue(null);
      mockUsersRepository.findByEmail.mockResolvedValue(null);
      mockUsersRepository.create.mockResolvedValue(newUser);

      const result = await service.googleAuth(profile);

      expect(mockUsersRepository.create).toHaveBeenCalled();
      expect(mockMailService.sendWelcome).toHaveBeenCalled();
      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'test-uuid',
      });
    });
  });
});
