# Global Error Handling + Structured Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global exception filter that translates unmapped Prisma/Stripe errors into the correct HTTP status, and structured JSON logging (via `nestjs-pino`) so every unexpected (≥500) error is logged with a full stack trace and a client-facing `errorId` for correlation, while expected (4xx) outcomes get a compact log line with no stack trace noise.

**Architecture:** One `@Catch()` global filter (`AllExceptionsFilter`, registered via `APP_FILTER`) tries two pure mapper functions (`mapPrismaError`, `mapStripeError`) to translate recognized third-party errors into NestJS `HttpException`s, falls back to a generic 500 for anything unrecognized, and logs via an injected `PinoLogger` — full stack trace + generated `errorId` for ≥500, compact message-only line for <500.

**Tech Stack:** `nestjs-pino` (structured logging, adds `pino-http` transitively for per-request correlation ids), `@prisma/client`'s `Prisma.PrismaClientKnownRequestError`, `stripe`'s `Stripe.errors.*` classes — no other new dependencies.

## Global Constraints

- Never change the status/message of an already-thrown `HttpException` (e.g. `NotFoundException('Bank account not found.')`) — the filter passes those through unchanged, only unrecognized errors are translated
- `errorId` appears ONLY in ≥500 responses — never add it to 4xx bodies
- ≥500: log at `error` level with full stack trace; <500: log at `warn` (401/403) or `info` (400/404/409), no stack trace
- `test/helpers/create-app.ts` needs the same `nestjs-pino` bootstrap wiring as `src/main.ts` (this file builds its own `INestApplication` independently of `main.ts`'s `bootstrap()`, same duplication pattern already established for the Swagger/Scalar setup in that file)
- No third-party observability platform (Datadog/Grafana/Sentry) integration — stdout JSON logs only
- No changes to external-call ordering (signup/requestEmailChange), webhook idempotency, or avatar `ext` validation — those are separate, later plans

---

### Task 1: Install nestjs-pino and wire up structured logging bootstrap

**Files:**
- Modify: `package.json` (via `npm install`)
- Modify: `src/app.module.ts`
- Modify: `src/main.ts`
- Modify: `test/helpers/create-app.ts`

**Interfaces:**
- Produces: every request now logged via `nestjs-pino`'s `pino-http` middleware (method/path/status/duration, one line per request) — no application code needs to call anything for this baseline logging, it's automatic once `LoggerModule.forRoot()` is registered

- [ ] **Step 1: Install the package**

```bash
npm install nestjs-pino
```

- [ ] **Step 2: Register `LoggerModule` in `src/app.module.ts`**

Add the import and provider — the file currently looks like this (read it first to confirm current state matches, since later tasks in this plan also touch it):

```ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuthGuard } from '@modules/auth/auth.guard';
import { UsersModule } from '@modules/users/users.module';
import { AuthModule } from '@modules/auth/auth.module';
import { CategoriesModule } from '@modules/categories/categories.module';
import { DatabaseModule } from '@shared/database/database.module';
import { MailModule } from '@shared/mail/mail.module';
import { StorageModule } from '@shared/storage/storage.module';
import { RolesGuard } from '@shared/guards/roles.guard';
import { BankAccountsModule } from './modules/bank-accounts/bank-accounts.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { PlanModule } from '@shared/plan/plan.module';
import { BillingModule } from '@shared/billing/billing.module';

@Module({
  imports: [
    LoggerModule.forRoot(),
    UsersModule,
    DatabaseModule,
    AuthModule,
    MailModule,
    StorageModule,
    CategoriesModule,
    BankAccountsModule,
    TransactionsModule,
    PlanModule,
    BillingModule,
  ],
  controllers: [],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
```

Note: do NOT import `APP_FILTER` yet — this repo's ESLint config (`@typescript-eslint/no-unused-vars`) fails the build on an unused import, so pre-importing it here (before Task 4 actually uses it) breaks `npm run lint`. Task 4 adds `APP_FILTER` to this same import line when it's actually used.

- [ ] **Step 3: Update `src/main.ts`'s bootstrap to use the pino logger**

The file currently boots with `NestFactory.create(AppModule, { rawBody: true })` then configures `ValidationPipe`, CORS, and the Swagger/Scalar reference. Add `bufferLogs: true` to the factory options and attach the logger right after creation:

```ts
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: '*' });

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

  app.use(
    '/reference',
    apiReference({
      content: document,
    }),
  );

  const port = 3000;
  await app.listen(port);
  console.log(`INFO: API Reference available at http://localhost:${port}/reference`);
}

void bootstrap();
```

- [ ] **Step 4: Apply the same `bufferLogs`/`useLogger` wiring to `test/helpers/create-app.ts`**

This file calls `module.createNestApplication({ rawBody: true })` — add `bufferLogs: true` to that same options object, then attach the logger right after, before the existing `ValidationPipe` line:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { Logger } from 'nestjs-pino';
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

  const app = module.createNestApplication({
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
```

- [ ] **Step 5: Verify the app boots and logs structured JSON**

```bash
npm run start:dev
```

Expected: instead of NestJS's default colorized console output, you should see JSON log lines (pino's default format), one per bootstrap step. Once it's up, hit any route (e.g. `curl http://localhost:3000/reference`) and confirm a JSON access-log line appears for that request, then stop the dev server (`pkill -f "nest start --watch"` on macOS, since `timeout` isn't available by default).

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```

Expected: all suites pass — this task only changes logging output format, not behavior.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/app.module.ts src/main.ts test/helpers/create-app.ts
git commit -m "feat: add structured JSON logging via nestjs-pino"
```

---

### Task 2: Prisma error mapper

**Files:**
- Create: `src/shared/filters/prisma-error.mapper.ts`
- Create: `src/shared/filters/prisma-error.mapper.spec.ts`

**Interfaces:**
- Produces: `mapPrismaError(error: unknown): HttpException | null` — used by Task 4's filter

- [ ] **Step 1: Write the failing test**

```ts
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mapPrismaError } from './prisma-error.mapper';

function makePrismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Simulated Prisma error', {
    code,
    clientVersion: '6.19.3',
  });
}

describe('mapPrismaError', () => {
  it('maps P2002 (unique constraint) to ConflictException', () => {
    const result = mapPrismaError(makePrismaError('P2002'));
    expect(result).toBeInstanceOf(ConflictException);
  });

  it('maps P2025 (record not found) to NotFoundException', () => {
    const result = mapPrismaError(makePrismaError('P2025'));
    expect(result).toBeInstanceOf(NotFoundException);
  });

  it('maps P2003 (foreign key violation) to BadRequestException', () => {
    const result = mapPrismaError(makePrismaError('P2003'));
    expect(result).toBeInstanceOf(BadRequestException);
  });

  it('returns null for an unrecognized Prisma error code', () => {
    const result = mapPrismaError(makePrismaError('P9999'));
    expect(result).toBeNull();
  });

  it('returns null for a non-Prisma error', () => {
    const result = mapPrismaError(new Error('some other error'));
    expect(result).toBeNull();
  });

  it('returns null for a non-error value', () => {
    expect(mapPrismaError('not an error')).toBeNull();
    expect(mapPrismaError(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/shared/filters/prisma-error.mapper.spec.ts
```

Expected: FAIL — `Cannot find module './prisma-error.mapper'`.

- [ ] **Step 3: Write the implementation**

```ts
import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

export function mapPrismaError(error: unknown): HttpException | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return null;
  }

  switch (error.code) {
    case 'P2002':
      return new ConflictException('A record with this value already exists.');
    case 'P2025':
      return new NotFoundException('Record not found.');
    case 'P2003':
      return new BadRequestException('Referenced record does not exist.');
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest src/shared/filters/prisma-error.mapper.spec.ts
```

Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add src/shared/filters/prisma-error.mapper.ts src/shared/filters/prisma-error.mapper.spec.ts
git commit -m "feat: add Prisma error mapper (P2002/P2025/P2003 -> HTTP status)"
```

---

### Task 3: Stripe error mapper

**Files:**
- Create: `src/shared/filters/stripe-error.mapper.ts`
- Create: `src/shared/filters/stripe-error.mapper.spec.ts`

**Interfaces:**
- Produces: `mapStripeError(error: unknown): HttpException | null` — used by Task 4's filter

- [ ] **Step 1: Write the failing test**

```ts
import { BadGatewayException, BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';
import { mapStripeError } from './stripe-error.mapper';

describe('mapStripeError', () => {
  it('maps StripeCardError to BadRequestException using Stripe\'s own message', () => {
    const cardError = new Stripe.errors.StripeCardError({
      message: 'Your card was declined.',
      type: 'StripeCardError',
    } as any);

    const result = mapStripeError(cardError);

    expect(result).toBeInstanceOf(BadRequestException);
    expect(result?.getResponse()).toEqual(
      expect.objectContaining({ message: 'Your card was declined.' }),
    );
  });

  it('maps StripeAPIError to BadGatewayException with a generic message', () => {
    const apiError = new Stripe.errors.StripeAPIError({
      message: 'Some internal Stripe detail that should not leak.',
      type: 'StripeAPIError',
    } as any);

    const result = mapStripeError(apiError);

    expect(result).toBeInstanceOf(BadGatewayException);
    expect(result?.getResponse()).toEqual(
      expect.objectContaining({ message: 'Payment provider error.' }),
    );
  });

  it('maps StripeConnectionError to BadGatewayException', () => {
    const connError = new Stripe.errors.StripeConnectionError({
      message: 'Network unreachable',
      type: 'StripeConnectionError',
    } as any);

    const result = mapStripeError(connError);

    expect(result).toBeInstanceOf(BadGatewayException);
  });

  it('returns null for a non-Stripe error', () => {
    const result = mapStripeError(new Error('some other error'));
    expect(result).toBeNull();
  });

  it('returns null for a non-error value', () => {
    expect(mapStripeError('not an error')).toBeNull();
    expect(mapStripeError(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/shared/filters/stripe-error.mapper.spec.ts
```

Expected: FAIL — `Cannot find module './stripe-error.mapper'`.

- [ ] **Step 3: Write the implementation**

```ts
import { BadGatewayException, BadRequestException, HttpException } from '@nestjs/common';
import Stripe from 'stripe';

export function mapStripeError(error: unknown): HttpException | null {
  if (!(error instanceof Stripe.errors.StripeError)) {
    return null;
  }

  if (error instanceof Stripe.errors.StripeCardError) {
    // StripeCardError messages are designed by Stripe to be safe to show
    // end users directly (e.g. "Your card was declined.").
    return new BadRequestException(error.message);
  }

  // Every other Stripe error subclass (StripeAPIError, StripeConnectionError,
  // StripeAuthenticationError, StripeInvalidRequestError, etc.) represents
  // either Stripe's own outage or our own misconfiguration — neither is safe
  // or useful to detail to the client.
  return new BadGatewayException('Payment provider error.');
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest src/shared/filters/stripe-error.mapper.spec.ts
```

Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add src/shared/filters/stripe-error.mapper.ts src/shared/filters/stripe-error.mapper.spec.ts
git commit -m "feat: add Stripe error mapper (card errors -> 400, everything else -> 502)"
```

---

### Task 4: Global exception filter

**Files:**
- Create: `src/shared/filters/all-exceptions.filter.ts`
- Create: `src/shared/filters/all-exceptions.filter.spec.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `mapPrismaError` (Task 2), `mapStripeError` (Task 3)
- Produces: registered globally via `APP_FILTER` — no other file calls this filter directly, NestJS invokes it automatically on any thrown error

- [ ] **Step 1: Write the failing test**

```ts
import { ArgumentsHost, HttpStatus, NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { Prisma } from '@prisma/client';

function makeMockHost(overrides: { url?: string; method?: string } = {}) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const request = { url: overrides.url ?? '/test', method: overrides.method ?? 'GET' };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  let mockLogger: jest.Mocked<Pick<PinoLogger, 'error' | 'warn' | 'info'>>;
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
    filter = new AllExceptionsFilter(mockLogger as unknown as PinoLogger);
  });

  it('logs an unrecognized error at error level with stack trace and errorId, returns 500', () => {
    const { host, status, json } = makeMockHost();
    const unexpected = new Error('boom');

    filter.catch(unexpected, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Internal server error',
        errorId: expect.stringMatching(/^[0-9a-f-]{8}$/),
      }),
    );
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    const [logPayload] = mockLogger.error.mock.calls[0];
    expect(logPayload.err).toBe(unexpected);
    expect(logPayload.errorId).toEqual(expect.stringMatching(/^[0-9a-f-]{8}$/));
  });

  it('passes through an existing HttpException unchanged, no errorId, logs at info level', () => {
    const { host, status, json } = makeMockHost();
    const notFound = new NotFoundException('Bank account not found.');

    filter.catch(notFound, host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Bank account not found.' }),
    );
    const [, body] = json.mock.calls[0];
    expect(body).not.toHaveProperty?.('errorId');
    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('translates a Prisma P2002 error to 409 via mapPrismaError', () => {
    const { host, status } = makeMockHost();
    const prismaError = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: '6.19.3',
    });

    filter.catch(prismaError, host);

    expect(status).toHaveBeenCalledWith(409);
    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('logs 401/403 at warn level, not info', () => {
    const { host } = makeMockHost();
    const { UnauthorizedException } = jest.requireActual('@nestjs/common');

    filter.catch(new UnauthorizedException(), host);

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/shared/filters/all-exceptions.filter.spec.ts
```

Expected: FAIL — `Cannot find module './all-exceptions.filter'`.

- [ ] **Step 3: Write the implementation**

```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { mapPrismaError } from './prisma-error.mapper';
import { mapStripeError } from './stripe-error.mapper';

interface MinimalRequest {
  url: string;
  method: string;
}

interface MinimalResponse {
  status: (code: number) => { json: (body: unknown) => void };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(AllExceptionsFilter.name)
    private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<MinimalResponse>();
    const request = ctx.getRequest<MinimalRequest>();

    const translated =
      mapPrismaError(exception) ?? mapStripeError(exception) ?? exception;

    const isHttpException = translated instanceof HttpException;
    const status = isHttpException
      ? translated.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500) {
      const errorId = randomUUID().slice(0, 8);
      this.logger.error(
        {
          err: exception,
          errorId,
          path: request.url,
          method: request.method,
        },
        'Unhandled exception',
      );
      response.status(status).json({
        statusCode: status,
        message: 'Internal server error',
        errorId,
      });
      return;
    }

    const body = isHttpException
      ? translated.getResponse()
      : { statusCode: status, message: 'Unknown error' };

    const logPayload = { path: request.url, method: request.method, status };
    const logMessage =
      typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message: unknown }).message)
        : 'Request rejected';

    if (status === 401 || status === 403) {
      this.logger.warn(logPayload, logMessage);
    } else {
      this.logger.info(logPayload, logMessage);
    }

    response.status(status).json(body);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest src/shared/filters/all-exceptions.filter.spec.ts
```

Expected: PASS, 4/4.

- [ ] **Step 5: Register the filter in `src/app.module.ts`**

Add `AllExceptionsFilter` to the providers array, and add `APP_FILTER` back to the `@nestjs/core` import on this line (Task 1 deliberately did NOT pre-import it, to avoid an unused-import lint failure — this is the task that actually uses it):

```ts
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuthGuard } from '@modules/auth/auth.guard';
import { UsersModule } from '@modules/users/users.module';
import { AuthModule } from '@modules/auth/auth.module';
import { CategoriesModule } from '@modules/categories/categories.module';
import { DatabaseModule } from '@shared/database/database.module';
import { MailModule } from '@shared/mail/mail.module';
import { StorageModule } from '@shared/storage/storage.module';
import { RolesGuard } from '@shared/guards/roles.guard';
import { AllExceptionsFilter } from '@shared/filters/all-exceptions.filter';
import { BankAccountsModule } from './modules/bank-accounts/bank-accounts.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { PlanModule } from '@shared/plan/plan.module';
import { BillingModule } from '@shared/billing/billing.module';

@Module({
  imports: [
    LoggerModule.forRoot(),
    UsersModule,
    DatabaseModule,
    AuthModule,
    MailModule,
    StorageModule,
    CategoriesModule,
    BankAccountsModule,
    TransactionsModule,
    PlanModule,
    BillingModule,
  ],
  controllers: [],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
```

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```

Expected: all suites pass. This is the critical regression check — the filter is now live for every route in every e2e spec file; any status-code assertion anywhere in the existing 8 e2e spec files that was implicitly relying on NestJS's default unhandled-error behavior would break here. If anything fails, read the failure carefully before assuming it's this filter's fault — it could also reveal a route this plan's scope reduction (audit finding #5) didn't anticipate.

- [ ] **Step 7: Commit**

```bash
git add src/shared/filters/all-exceptions.filter.ts src/shared/filters/all-exceptions.filter.spec.ts src/app.module.ts
git commit -m "feat: register global exception filter (Prisma/Stripe translation, structured logging)"
```

---

### Task 5: Close the loop on audit finding #5 with a live e2e test

**Files:**
- Modify: `test/e2e/admin.e2e-spec.ts`

**Interfaces:**
- Consumes: `createApp`, `cleanDatabase`, `signUpAndGetTokens`, `uniqueEmail` — same helpers this file already uses

This is the one test in this plan that proves the filter works against a REAL Prisma unique-constraint violation, not just a mocked error object in Task 4's unit test.

- [ ] **Step 1: Read the current `test/e2e/admin.e2e-spec.ts`** to find its `describe('POST /users', ...)` block and match its existing style (admin token setup, etc.) before adding to it.

- [ ] **Step 2: Add one test to the existing `POST /users` describe block**

```ts
it('returns 409 when creating a user with an email that already exists', async () => {
  const email = uniqueEmail('duplicate');
  const { accessToken } = await signUpAdmin();

  await request(app.getHttpServer())
    .post('/users')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      name: 'First User',
      email,
      password: 'Test@1234',
      role: 'USER',
    });

  const res = await request(app.getHttpServer())
    .post('/users')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      name: 'Second User',
      email,
      password: 'Test@1234',
      role: 'USER',
    });

  expect(res.status).toBe(409);
});
```

`signUpAdmin` is the local helper already defined in this file at line 23 (from the original admin e2e task) — reuse it, don't redefine it.

- [ ] **Step 3: Run the focused test**

```bash
npm run test:e2e -- --testPathPatterns=admin --no-coverage
```

Expected: all admin tests pass, including the new one — confirming `POST /users` with a duplicate email now returns 409, not 500.

- [ ] **Step 4: Run the full combined suite**

```bash
npm test
```

Expected: all suites pass.

- [ ] **Step 5: Commit**

```bash
git add test/e2e/admin.e2e-spec.ts
git commit -m "test(e2e): verify duplicate-email admin create returns 409 via global filter"
```
