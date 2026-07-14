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

import { AuthController } from './auth.controller';
import { AuthService } from '../../application/auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let mockAuthService: { googleAuth: jest.Mock };

  beforeEach(() => {
    mockAuthService = {
      googleAuth: jest.fn(),
    };
    controller = new AuthController(mockAuthService as unknown as AuthService);
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
