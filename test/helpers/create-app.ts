import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { AppModule } from '../../src/app.module';
import { MailService } from '../../src/shared/mail/mail.service';
import { StorageService } from '../../src/shared/storage/storage.service';
import { BillingService } from '../../src/shared/billing/billing.service';
import { BillingWebhookHandler } from '../../src/shared/billing/billing.webhook';

dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

export const mockMailService = {
  sendWelcome: jest.fn().mockResolvedValue(undefined),
  sendEmailChangeConfirmation: jest.fn().mockResolvedValue(undefined),
  sendDowngradeNotification: jest.fn().mockResolvedValue(undefined),
  sendSubscriptionCancelled: jest.fn().mockResolvedValue(undefined),
};

export const mockStorageService = {
  generateUploadUrl: jest.fn().mockResolvedValue({
    uploadUrl: 'https://s3.example.com/upload',
    avatarUrl: 'https://s3.example.com/avatar.jpg',
  }),
};

export const mockBillingService = {
  createSetupIntent: jest
    .fn()
    .mockResolvedValue({ clientSecret: 'seti_fake_secret' }),
  createSubscription: jest.fn().mockResolvedValue(undefined),
  changePlan: jest.fn().mockResolvedValue(undefined),
  cancelSubscription: jest.fn().mockResolvedValue(undefined),
  createCustomerAndSubscribe: jest.fn().mockResolvedValue(undefined),
};

export const mockBillingWebhookHandler = {
  handle: jest.fn().mockResolvedValue(undefined),
};

export async function createApp(): Promise<INestApplication> {
  const module: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MailService)
    .useValue(mockMailService)
    .overrideProvider(StorageService)
    .useValue(mockStorageService)
    .overrideProvider(BillingService)
    .useValue(mockBillingService)
    .overrideProvider(BillingWebhookHandler)
    .useValue(mockBillingWebhookHandler)
    .compile();

  const app = module.createNestApplication({ rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}
