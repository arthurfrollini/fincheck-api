import { StorageService } from './storage.service';

// Mock env to avoid validation errors during tests
jest.mock('@shared/config/env', () => ({
  env: {
    awsRegion: 'us-east-1',
    awsAccessKeyId: 'test-access-key',
    awsSecretAccessKey: 'test-secret-key',
    awsS3BucketName: 'test-bucket',
  },
}));

// Mock the AWS SDK modules before importing StorageService
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({})),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://s3.example.com/presigned-url'),
}));

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    service = new StorageService();
  });

  describe('generateUploadUrl', () => {
    it('returns uploadUrl and avatarUrl', async () => {
      const result = await service.generateUploadUrl('user-123', 'jpg');

      expect(result.uploadUrl).toBe('https://s3.example.com/presigned-url');
      expect(result.avatarUrl).toMatch(/^https:\/\/.+\/avatars\/user-123\/.+\.jpg$/);
    });

    it('builds key as avatars/{userId}/{uuid}.{ext}', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PutObjectCommand } = require('@aws-sdk/client-s3') as typeof import('@aws-sdk/client-s3');

      await service.generateUploadUrl('user-abc', 'png');

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: expect.stringMatching(/^avatars\/user-abc\/.+\.png$/),
        }),
      );
    });
  });
});
