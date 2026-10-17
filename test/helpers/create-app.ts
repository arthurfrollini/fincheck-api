import { Test, TestingModule } from '@nestjs/testing';
import { mock } from 'jest-mock-extended';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { App } from 'supertest/types';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { Logger } from 'nestjs-pino';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { AppModule } from '../../src/app.module';
import { MailService } from '../../src/shared/mail/mail.service';
import { StorageService } from '../../src/shared/storage/storage.service';
import { BillingService } from '../../src/shared/billing/billing.service';
import { LlmService } from '../../src/shared/llm/llm.service';
import { EmbeddingProvider } from '../../src/modules/education/domain/embedding-provider';

dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

export const mockMailService = mock<MailService>();
mockMailService.sendWelcome.mockResolvedValue(undefined);
mockMailService.sendEmailChangeConfirmation.mockResolvedValue(undefined);
mockMailService.sendDowngradeNotification.mockResolvedValue(undefined);
mockMailService.sendSubscriptionCancelled.mockResolvedValue(undefined);

export const mockStorageService = mock<StorageService>();
mockStorageService.generateUploadUrl.mockResolvedValue({
  uploadUrl: 'https://s3.example.com/upload',
  avatarUrl: 'https://s3.example.com/avatar.jpg',
});

export const mockBillingService = mock<BillingService>();
mockBillingService.createSetupIntent.mockResolvedValue({
  clientSecret: 'seti_fake_secret',
});
mockBillingService.createSubscription.mockResolvedValue(undefined);
mockBillingService.changePlan.mockResolvedValue(undefined);
mockBillingService.cancelSubscription.mockResolvedValue(undefined);
mockBillingService.createCustomerAndSubscribe.mockResolvedValue(undefined);

// The Claude API is an external boundary like Resend or Stripe: e2e never
// calls it. Specs that exercise categorization set return values per test.
export const mockLlmService = mock<LlmService>();

// Deterministic stand-in for the local embedding model: each text maps to a
// one-hot 384-d vector chosen by a hash, so identical texts have similarity
// 1 and different texts almost always 0. Keeps e2e off the 120 MB model.
export function fakeEmbedding(text: string): number[] {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const vector = new Array<number>(384).fill(0);
  vector[hash % 384] = 1;
  return vector;
}

export const fakeEmbeddingProvider = {
  dimensions: 384,
  embedQuery: (text: string) => Promise.resolve(fakeEmbedding(text)),
  embedPassages: (texts: string[]) => Promise.resolve(texts.map(fakeEmbedding)),
};

export async function createApp(): Promise<INestApplication<App>> {
  const module: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MailService)
    .useValue(mockMailService)
    .overrideProvider(StorageService)
    .useValue(mockStorageService)
    .overrideProvider(BillingService)
    .useValue(mockBillingService)
    .overrideProvider(LlmService)
    .useValue(mockLlmService)
    .overrideProvider(EmbeddingProvider)
    .useValue(fakeEmbeddingProvider)
    .compile();

  const app = module.createNestApplication<INestApplication<App>>({
    rawBody: true,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle('Fincheck API')
    .setDescription(
      'REST API for a personal finance management app. Users track bank accounts and transactions, organized by category, with plan-based feature limits enforced via Stripe subscriptions.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('reference', app, document, {
    jsonDocumentUrl: 'reference-json',
    swaggerUiEnabled: false,
  });

  app.use('/reference', apiReference({ content: document }));

  // Each e2e spec file boots its own app on its own ephemeral port in the
  // same Jest worker process. Without this, a keep-alive socket left open
  // by supertest against one app can occasionally get reused against the
  // next app's port, producing a client-side "Parse Error: Expected HTTP/,
  // RTSP/ or ICE/" — force every response to close its connection instead.
  app.use(
    (
      _req: unknown,
      res: { set: (k: string, v: string) => void },
      next: () => void,
    ) => {
      res.set('Connection', 'close');
      next();
    },
  );
  await app.init();
  return app;
}
