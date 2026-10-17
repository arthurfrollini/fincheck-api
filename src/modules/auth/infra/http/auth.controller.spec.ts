jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));
jest.mock('bcryptjs', () => ({
  hash: () => Promise.resolve('hashed'),
  compare: () => Promise.resolve(false),
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

import { mock, type MockProxy } from 'jest-mock-extended';
import { AuthController } from './auth.controller';
import { AuthService } from '../../application/auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let mockAuthService: MockProxy<AuthService>;

  beforeEach(() => {
    mockAuthService = mock<AuthService>();
    controller = new AuthController(mockAuthService);
  });

  describe('googleCallback', () => {
    it('returns a redirect url containing accessToken and refreshToken', async () => {
      mockAuthService.googleAuth.mockResolvedValue({
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
      });

      const result = await controller.googleCallback({
        user: { googleId: 'g1', email: 'a@b.com', name: 'A' },
      });

      expect(mockAuthService.googleAuth).toHaveBeenCalledWith({
        googleId: 'g1',
        email: 'a@b.com',
        name: 'A',
      });
      expect(result.url).toContain('accessToken=access-123');
      expect(result.url).toContain('refreshToken=refresh-456');
      expect(result.url).toBe(
        'http://localhost:3001?accessToken=access-123&refreshToken=refresh-456',
      );
    });
  });
});
