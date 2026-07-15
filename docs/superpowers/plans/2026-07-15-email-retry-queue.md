# Email Retry Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `signup` and `requestEmailChange` resilient to Resend (email provider) failures — the API response must depend only on the database write succeeding, with email delivery handled asynchronously via a retrying BullMQ queue, so a Resend outage never turns an otherwise-successful signup/email-change into a 500.

**Architecture:** A new `MailQueueService` replaces the direct `MailService` calls in `AuthService`/`UsersService` — it only enqueues a BullMQ job (wrapped in try/catch so it can never throw). A new `MailProcessor` (BullMQ worker) consumes those jobs and calls the existing `MailService` methods, which still do the real Resend call. If `MailService` throws inside the processor, BullMQ retries the job using a custom backoff strategy (~60 attempts, capped at 30 minutes, covering ~24h of sustained outage).

**Tech Stack:** `bullmq` + `@nestjs/bullmq` (queue), Redis (new infra dependency, via `docker-compose.yml`), `RedisInsight` (dev-only GUI, via `docker-compose.yml`). No changes to `MailService` itself or to Resend usage.

## Global Constraints

- Only `signup` (welcome email, in `AuthService.signup` AND `AuthService.googleAuth`) and `requestEmailChange` (confirmation email, in `UsersService.requestEmailChange`) move to the queue. `sendDowngradeNotification`/`sendSubscriptionCancelled` (billing webhook) are explicitly out of scope — different problem (webhook idempotency), later plan.
- Nothing past the database write may fail the request. `MailQueueService`'s `queue.add()` call is wrapped in try/catch — a Redis outage must be caught, logged, and swallowed, never rethrown.
- Retry backoff: custom strategy named `email-retry`, delay doubles from 1s starting at `attemptsMade === 1`, caps at 30 minutes (`1800000`ms), `attempts: 60` total (covers ~24h of sustained Resend outage).
- `MailService` itself is unchanged — it remains the only thing e2e tests mock. `MailQueueService`/`MailProcessor`/the Redis queue run for real in e2e tests, against the real `redis` container.
- No general-purpose queue module — BullMQ wiring lives inside `MailModule` (`@Global()`), since mail is the only queue consumer right now.
- No UI/frontend work in this plan (backend-only).

---

### Task 1: Redis + RedisInsight infra and env config

**Files:**
- Modify: `docker-compose.yml`
- Modify: `src/shared/config/env.ts`
- Modify: `.env.test`
- Modify: `.env.example`

**Interfaces:**
- Produces: `env.redisHost: string`, `env.redisPort: string` — later tasks read these (parsing `Number(env.redisPort)` at the one call site that needs a number, `src/shared/mail/mail.module.ts` in Task 2) to build the BullMQ `connection` config object.

- [ ] **Step 1: Add `redis` and `redisinsight` services to `docker-compose.yml`**

The file currently looks like this:

```yaml
services:
  db:
    image: postgres:17
    container_name: pg
    restart: unless-stopped
    environment:
      POSTGRES_USER: root
      POSTGRES_PASSWORD: root
      POSTGRES_DB: fincheck
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/init.sql:/docker-entrypoint-initdb.d/init.sql

volumes:
  postgres_data:
```

Replace it with:

```yaml
services:
  db:
    image: postgres:17
    container_name: pg
    restart: unless-stopped
    environment:
      POSTGRES_USER: root
      POSTGRES_PASSWORD: root
      POSTGRES_DB: fincheck
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/init.sql:/docker-entrypoint-initdb.d/init.sql

  redis:
    image: redis:7-alpine
    container_name: redis
    restart: unless-stopped
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data

  redisinsight:
    image: redis/redisinsight:latest
    container_name: redisinsight
    restart: unless-stopped
    ports:
      - '5540:5540'
    volumes:
      - redisinsight_data:/data

volumes:
  postgres_data:
  redis_data:
  redisinsight_data:
```

- [ ] **Step 2: Bring the new services up and verify Redis responds**

```bash
docker compose up -d
docker compose ps
docker exec redis redis-cli ping
```

Expected: `docker compose ps` shows `redis` and `redisinsight` both `Up`/healthy; `redis-cli ping` prints `PONG`.

- [ ] **Step 3: Add `redisHost`/`redisPort` to `src/shared/config/env.ts`**

The file currently looks like this:

```ts
import { plainToInstance } from 'class-transformer';
import { IsNotEmpty, IsString, validateSync } from 'class-validator';

class Env {
  @IsString() @IsNotEmpty() jwtSecret: string;
  @IsString() @IsNotEmpty() databaseURL: string;
  @IsString() @IsNotEmpty() resendApiKey: string;
  @IsString() @IsNotEmpty() resendFromEmail: string;
  @IsString() @IsNotEmpty() googleClientId: string;
  @IsString() @IsNotEmpty() googleClientSecret: string;
  @IsString() @IsNotEmpty() googleCallbackUrl: string;
  @IsString() @IsNotEmpty() awsRegion: string;
  @IsString() @IsNotEmpty() awsAccessKeyId: string;
  @IsString() @IsNotEmpty() awsSecretAccessKey: string;
  @IsString() @IsNotEmpty() awsS3BucketName: string;
  @IsString() @IsNotEmpty() stripeSecretKey: string;
  @IsString() @IsNotEmpty() stripeWebhookSecret: string;
  @IsString() @IsNotEmpty() stripePriceGold: string;
  @IsString() @IsNotEmpty() stripePricePlatinum: string;
}

export const env: Env = plainToInstance(Env, {
  jwtSecret: process.env.JWT_SECRET,
  databaseURL: process.env.DATABASE_URL,
  resendApiKey: process.env.RESEND_API_KEY,
  resendFromEmail: process.env.RESEND_FROM_EMAIL,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL,
  awsRegion: process.env.AWS_REGION,
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  awsS3BucketName: process.env.AWS_S3_BUCKET_NAME,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  stripePriceGold: process.env.STRIPE_PRICE_GOLD,
  stripePricePlatinum: process.env.STRIPE_PRICE_PLATINUM,
});

const errors = validateSync(env);
if (errors.length > 0) {
  throw new Error(JSON.stringify(errors, null, 2));
}
```

Add `redisHost`/`redisPort` fields, following the existing all-string-fields convention (parsing to a number happens at the one call site that needs it, not here):

```ts
class Env {
  @IsString() @IsNotEmpty() jwtSecret: string;
  @IsString() @IsNotEmpty() databaseURL: string;
  @IsString() @IsNotEmpty() resendApiKey: string;
  @IsString() @IsNotEmpty() resendFromEmail: string;
  @IsString() @IsNotEmpty() googleClientId: string;
  @IsString() @IsNotEmpty() googleClientSecret: string;
  @IsString() @IsNotEmpty() googleCallbackUrl: string;
  @IsString() @IsNotEmpty() awsRegion: string;
  @IsString() @IsNotEmpty() awsAccessKeyId: string;
  @IsString() @IsNotEmpty() awsSecretAccessKey: string;
  @IsString() @IsNotEmpty() awsS3BucketName: string;
  @IsString() @IsNotEmpty() stripeSecretKey: string;
  @IsString() @IsNotEmpty() stripeWebhookSecret: string;
  @IsString() @IsNotEmpty() stripePriceGold: string;
  @IsString() @IsNotEmpty() stripePricePlatinum: string;
  @IsString() @IsNotEmpty() redisHost: string;
  @IsString() @IsNotEmpty() redisPort: string;
}

export const env: Env = plainToInstance(Env, {
  jwtSecret: process.env.JWT_SECRET,
  databaseURL: process.env.DATABASE_URL,
  resendApiKey: process.env.RESEND_API_KEY,
  resendFromEmail: process.env.RESEND_FROM_EMAIL,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL,
  awsRegion: process.env.AWS_REGION,
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  awsS3BucketName: process.env.AWS_S3_BUCKET_NAME,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  stripePriceGold: process.env.STRIPE_PRICE_GOLD,
  stripePricePlatinum: process.env.STRIPE_PRICE_PLATINUM,
  redisHost: process.env.REDIS_HOST,
  redisPort: process.env.REDIS_PORT,
});

const errors = validateSync(env);
if (errors.length > 0) {
  throw new Error(JSON.stringify(errors, null, 2));
}
```

- [ ] **Step 4: Add the new vars to `.env.test`**

`.env.test` currently ends with:

```
STRIPE_PRICE_PLATINUM=price_platinum_fake
```

Append:

```
REDIS_HOST=localhost
REDIS_PORT=6379
```

- [ ] **Step 5: Add the new vars (empty) to `.env.example`**

`.env.example` currently ends with:

```
STRIPE_PRICE_PLATINUM=
```

Append:

```
REDIS_HOST=
REDIS_PORT=
```

- [ ] **Step 6: Add the same vars to your local `.env`**

`.env` is gitignored — add these two lines yourself (not scripted, since this file holds your real local secrets):

```
REDIS_HOST=localhost
REDIS_PORT=6379
```

- [ ] **Step 7: Confirm nothing broke**

```bash
npm run test:unit
```

Expected: same pass count as before this task (every unit spec that touches `env` mocks the whole module via `jest.mock('@shared/config/env', ...)` — grep confirms no unit spec imports the real module, so adding required fields here cannot break unit tests).

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml src/shared/config/env.ts .env.test .env.example
git commit -m "chore: add Redis + RedisInsight to docker-compose, add REDIS_HOST/REDIS_PORT env vars"
```

---

### Task 2: Install BullMQ, wire `MailModule`, add `MailQueueService` (enqueue side)

**Files:**
- Modify: `package.json` (via `npm install`)
- Create: `src/shared/mail/mail-job.types.ts`
- Create: `src/shared/mail/mail-queue.service.ts`
- Create: `src/shared/mail/mail-queue.service.spec.ts`
- Modify: `src/shared/mail/mail.module.ts`

**Interfaces:**
- Consumes: `env.redisHost`, `env.redisPort` (Task 1).
- Produces: `MailQueueService.queueWelcome(to: string, name: string): Promise<void>`, `MailQueueService.queueEmailChangeConfirmation(to: string, token: string): Promise<void>` — Task 4 calls these from `AuthService`/`UsersService`. `MAIL_QUEUE_NAME = 'mail'`, `WELCOME_JOB_NAME = 'welcome'`, `EMAIL_CHANGE_CONFIRMATION_JOB_NAME = 'email-change-confirmation'`, `EMAIL_RETRY_BACKOFF_TYPE = 'email-retry'` — Task 3's `MailProcessor` and Task 5's e2e tests both need these exact string constants, imported from `mail-job.types.ts`.

- [ ] **Step 1: Install the packages**

```bash
npm install @nestjs/bullmq@^11.0.4 bullmq@^5.80.4
```

- [ ] **Step 2: Write `src/shared/mail/mail-job.types.ts`**

```ts
export const MAIL_QUEUE_NAME = 'mail';
export const WELCOME_JOB_NAME = 'welcome';
export const EMAIL_CHANGE_CONFIRMATION_JOB_NAME = 'email-change-confirmation';
export const EMAIL_RETRY_BACKOFF_TYPE = 'email-retry';
export const EMAIL_RETRY_MAX_ATTEMPTS = 60;
export const EMAIL_RETRY_MAX_DELAY_MS = 30 * 60 * 1000;

export interface WelcomeJobData {
  to: string;
  name: string;
}

export interface EmailChangeConfirmationJobData {
  to: string;
  token: string;
}
```

- [ ] **Step 3: Write the failing test for `MailQueueService`**

Create `src/shared/mail/mail-queue.service.spec.ts`:

```ts
import { PinoLogger } from 'nestjs-pino';
import { Queue } from 'bullmq';
import { MailQueueService } from './mail-queue.service';
import {
  WELCOME_JOB_NAME,
  EMAIL_CHANGE_CONFIRMATION_JOB_NAME,
  EMAIL_RETRY_BACKOFF_TYPE,
  EMAIL_RETRY_MAX_ATTEMPTS,
} from './mail-job.types';

describe('MailQueueService', () => {
  let mockQueue: jest.Mocked<Pick<Queue, 'add'>>;
  let mockLogger: jest.Mocked<Pick<PinoLogger, 'error'>>;
  let service: MailQueueService;

  beforeEach(() => {
    mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
    mockLogger = { error: jest.fn() };
    service = new MailQueueService(
      mockQueue as unknown as Queue,
      mockLogger as unknown as PinoLogger,
    );
  });

  it('enqueues a welcome job with the retry config', async () => {
    await service.queueWelcome('user@example.com', 'Arthur');

    expect(mockQueue.add).toHaveBeenCalledWith(
      WELCOME_JOB_NAME,
      { to: 'user@example.com', name: 'Arthur' },
      {
        attempts: EMAIL_RETRY_MAX_ATTEMPTS,
        backoff: { type: EMAIL_RETRY_BACKOFF_TYPE },
      },
    );
  });

  it('enqueues an email-change-confirmation job with the retry config', async () => {
    await service.queueEmailChangeConfirmation('user@example.com', 'tok-123');

    expect(mockQueue.add).toHaveBeenCalledWith(
      EMAIL_CHANGE_CONFIRMATION_JOB_NAME,
      { to: 'user@example.com', token: 'tok-123' },
      {
        attempts: EMAIL_RETRY_MAX_ATTEMPTS,
        backoff: { type: EMAIL_RETRY_BACKOFF_TYPE },
      },
    );
  });

  it('catches and logs a queue.add failure instead of throwing', async () => {
    mockQueue.add.mockRejectedValueOnce(new Error('redis unreachable'));

    await expect(
      service.queueWelcome('user@example.com', 'Arthur'),
    ).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    const [logPayload, message] = mockLogger.error.mock.calls[0] as [
      { err: unknown; jobName: string },
      string,
    ];
    expect(logPayload.jobName).toBe(WELCOME_JOB_NAME);
    expect(logPayload.err).toBeInstanceOf(Error);
    expect(message).toBe(
      'Failed to enqueue mail job — email will not be sent',
    );
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx jest src/shared/mail/mail-queue.service.spec.ts`
Expected: FAIL with "Cannot find module './mail-queue.service'"

- [ ] **Step 5: Write `src/shared/mail/mail-queue.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  MAIL_QUEUE_NAME,
  WELCOME_JOB_NAME,
  EMAIL_CHANGE_CONFIRMATION_JOB_NAME,
  EMAIL_RETRY_BACKOFF_TYPE,
  EMAIL_RETRY_MAX_ATTEMPTS,
  WelcomeJobData,
  EmailChangeConfirmationJobData,
} from './mail-job.types';

@Injectable()
export class MailQueueService {
  constructor(
    @InjectQueue(MAIL_QUEUE_NAME) private readonly mailQueue: Queue,
    @InjectPinoLogger(MailQueueService.name)
    private readonly logger: PinoLogger,
  ) {}

  async queueWelcome(to: string, name: string): Promise<void> {
    await this.enqueue<WelcomeJobData>(WELCOME_JOB_NAME, { to, name });
  }

  async queueEmailChangeConfirmation(
    to: string,
    token: string,
  ): Promise<void> {
    await this.enqueue<EmailChangeConfirmationJobData>(
      EMAIL_CHANGE_CONFIRMATION_JOB_NAME,
      { to, token },
    );
  }

  private async enqueue<T extends object>(
    jobName: string,
    data: T,
  ): Promise<void> {
    try {
      await this.mailQueue.add(jobName, data, {
        attempts: EMAIL_RETRY_MAX_ATTEMPTS,
        backoff: { type: EMAIL_RETRY_BACKOFF_TYPE },
      });
    } catch (err) {
      this.logger.error(
        { err, jobName },
        'Failed to enqueue mail job — email will not be sent',
      );
    }
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx jest src/shared/mail/mail-queue.service.spec.ts`
Expected: PASS, 3/3

- [ ] **Step 7: Wire `BullModule` into `src/shared/mail/mail.module.ts`**

The file currently looks like this:

```ts
import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
```

Replace it with:

```ts
import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { env } from '@shared/config/env';
import { MailService } from './mail.service';
import { MailQueueService } from './mail-queue.service';
import { MAIL_QUEUE_NAME } from './mail-job.types';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: { host: env.redisHost, port: Number(env.redisPort) },
      }),
    }),
    BullModule.registerQueue({ name: MAIL_QUEUE_NAME }),
  ],
  providers: [MailService, MailQueueService],
  exports: [MailService, MailQueueService],
})
export class MailModule {}
```

Note: `MailProcessor` is added to this module's `providers` in Task 3, not here — this task only wires the enqueue side.

- [ ] **Step 8: Confirm the app still boots and nothing regressed**

```bash
npm run test:unit
```

Expected: all unit tests pass, including the new 3 in `mail-queue.service.spec.ts`.

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/shared/mail/mail-job.types.ts src/shared/mail/mail-queue.service.ts src/shared/mail/mail-queue.service.spec.ts src/shared/mail/mail.module.ts
git commit -m "feat: add MailQueueService (BullMQ enqueue side) for resilient email delivery"
```

---

### Task 3: `MailProcessor` (dequeue side) with custom retry backoff

**Files:**
- Create: `src/shared/mail/mail.processor.ts`
- Create: `src/shared/mail/mail.processor.spec.ts`
- Modify: `src/shared/mail/mail.module.ts`

**Interfaces:**
- Consumes: `MailService.sendWelcome(to: string, name: string): Promise<void>`, `MailService.sendEmailChangeConfirmation(to: string, token: string): Promise<void>` (both already exist, unchanged). `MAIL_QUEUE_NAME`, `WELCOME_JOB_NAME`, `EMAIL_CHANGE_CONFIRMATION_JOB_NAME`, `EMAIL_RETRY_BACKOFF_TYPE`, `EMAIL_RETRY_MAX_DELAY_MS`, `WelcomeJobData`, `EmailChangeConfirmationJobData` from Task 2's `mail-job.types.ts`.
- Produces: nothing new consumed by later tasks — this is the terminal consumer of the queue.

- [ ] **Step 1: Write the failing test for `MailProcessor`**

Create `src/shared/mail/mail.processor.spec.ts`:

```ts
import { Job } from 'bullmq';
import { MailProcessor } from './mail.processor';
import { MailService } from './mail.service';
import {
  WELCOME_JOB_NAME,
  EMAIL_CHANGE_CONFIRMATION_JOB_NAME,
  EMAIL_RETRY_MAX_DELAY_MS,
} from './mail-job.types';

const makeJob = (name: string, data: object): Job =>
  ({ name, data }) as unknown as Job;

describe('MailProcessor', () => {
  let mockMailService: jest.Mocked<
    Pick<MailService, 'sendWelcome' | 'sendEmailChangeConfirmation'>
  >;
  let processor: MailProcessor;

  beforeEach(() => {
    mockMailService = {
      sendWelcome: jest.fn().mockResolvedValue(undefined),
      sendEmailChangeConfirmation: jest.fn().mockResolvedValue(undefined),
    };
    processor = new MailProcessor(mockMailService as unknown as MailService);
  });

  it('calls sendWelcome for a welcome job', async () => {
    const job = makeJob(WELCOME_JOB_NAME, {
      to: 'user@example.com',
      name: 'Arthur',
    });

    await processor.process(job);

    expect(mockMailService.sendWelcome).toHaveBeenCalledWith(
      'user@example.com',
      'Arthur',
    );
  });

  it('calls sendEmailChangeConfirmation for an email-change-confirmation job', async () => {
    const job = makeJob(EMAIL_CHANGE_CONFIRMATION_JOB_NAME, {
      to: 'user@example.com',
      token: 'tok-123',
    });

    await processor.process(job);

    expect(mockMailService.sendEmailChangeConfirmation).toHaveBeenCalledWith(
      'user@example.com',
      'tok-123',
    );
  });

  it('throws on an unrecognized job name (lets BullMQ mark it failed)', async () => {
    const job = makeJob('unknown-job', {});

    await expect(processor.process(job)).rejects.toThrow(
      'Unknown mail job name: unknown-job',
    );
  });

  it('does not catch a MailService failure — lets it propagate for BullMQ to retry', async () => {
    mockMailService.sendWelcome.mockRejectedValueOnce(
      new Error('Resend unreachable'),
    );
    const job = makeJob(WELCOME_JOB_NAME, {
      to: 'user@example.com',
      name: 'Arthur',
    });

    await expect(processor.process(job)).rejects.toThrow(
      'Resend unreachable',
    );
  });

  describe('email-retry backoff strategy', () => {
    it('doubles the delay starting at 1000ms', () => {
      expect(MailProcessor.emailRetryBackoffStrategy(1)).toBe(1000);
      expect(MailProcessor.emailRetryBackoffStrategy(2)).toBe(2000);
      expect(MailProcessor.emailRetryBackoffStrategy(3)).toBe(4000);
    });

    it('caps at 30 minutes', () => {
      expect(MailProcessor.emailRetryBackoffStrategy(20)).toBe(
        EMAIL_RETRY_MAX_DELAY_MS,
      );
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/shared/mail/mail.processor.spec.ts`
Expected: FAIL with "Cannot find module './mail.processor'"

- [ ] **Step 3: Write `src/shared/mail/mail.processor.ts`**

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { MailService } from './mail.service';
import {
  MAIL_QUEUE_NAME,
  WELCOME_JOB_NAME,
  EMAIL_CHANGE_CONFIRMATION_JOB_NAME,
  EMAIL_RETRY_BACKOFF_TYPE,
  EMAIL_RETRY_MAX_DELAY_MS,
  WelcomeJobData,
  EmailChangeConfirmationJobData,
} from './mail-job.types';

@Processor(MAIL_QUEUE_NAME, {
  settings: {
    backoffStrategy: (attemptsMade: number, type?: string) => {
      if (type !== EMAIL_RETRY_BACKOFF_TYPE) {
        throw new Error(`Unknown backoff strategy type: ${type}`);
      }
      return MailProcessor.emailRetryBackoffStrategy(attemptsMade);
    },
  },
})
export class MailProcessor extends WorkerHost {
  static emailRetryBackoffStrategy(attemptsMade: number): number {
    const delay = 2 ** (attemptsMade - 1) * 1000;
    return Math.min(delay, EMAIL_RETRY_MAX_DELAY_MS);
  }

  constructor(private readonly mailService: MailService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === WELCOME_JOB_NAME) {
      const { to, name } = job.data as WelcomeJobData;
      await this.mailService.sendWelcome(to, name);
      return;
    }

    if (job.name === EMAIL_CHANGE_CONFIRMATION_JOB_NAME) {
      const { to, token } = job.data as EmailChangeConfirmationJobData;
      await this.mailService.sendEmailChangeConfirmation(to, token);
      return;
    }

    throw new Error(`Unknown mail job name: ${job.name}`);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/shared/mail/mail.processor.spec.ts`
Expected: PASS, 6/6

- [ ] **Step 5: Register `MailProcessor` in `src/shared/mail/mail.module.ts`**

Modify the `providers` array (from Task 2's version of this file) to add `MailProcessor`:

```ts
import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { env } from '@shared/config/env';
import { MailService } from './mail.service';
import { MailQueueService } from './mail-queue.service';
import { MailProcessor } from './mail.processor';
import { MAIL_QUEUE_NAME } from './mail-job.types';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: { host: env.redisHost, port: Number(env.redisPort) },
      }),
    }),
    BullModule.registerQueue({ name: MAIL_QUEUE_NAME }),
  ],
  providers: [MailService, MailQueueService, MailProcessor],
  exports: [MailService, MailQueueService],
})
export class MailModule {}
```

`MailProcessor` is not exported — nothing outside `MailModule` needs to inject it, it just needs to exist as a provider so Nest instantiates the `@Processor`-decorated worker.

- [ ] **Step 6: Confirm nothing regressed**

```bash
npm run test:unit
npx tsc --noEmit
```

Expected: all unit tests pass (6 new in `mail.processor.spec.ts`), no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/shared/mail/mail.processor.ts src/shared/mail/mail.processor.spec.ts src/shared/mail/mail.module.ts
git commit -m "feat: add MailProcessor (BullMQ worker) with capped-exponential retry backoff"
```

---

### Task 4: Wire callers — `AuthService` and `UsersService` use `MailQueueService`

**Files:**
- Modify: `src/modules/auth/application/auth.service.ts`
- Modify: `src/modules/auth/application/auth.service.spec.ts`
- Modify: `src/modules/users/application/users.service.ts`
- Modify: `src/modules/users/application/users.service.spec.ts`

**Interfaces:**
- Consumes: `MailQueueService.queueWelcome`, `MailQueueService.queueEmailChangeConfirmation` (Task 2).
- Produces: nothing new — this task only changes call sites and their unit tests.

- [ ] **Step 1: Update `AuthService`'s failing assertions first**

`src/modules/auth/application/auth.service.spec.ts` currently imports `MailService` and asserts against `mockMailService.sendWelcome`. Change the import and every reference:

Replace:
```ts
import { MailService } from '@shared/mail/mail.service';
```
with:
```ts
import { MailQueueService } from '@shared/mail/mail-queue.service';
```

Replace:
```ts
const mockMailService = {
  sendWelcome: jest.fn(),
};
```
with:
```ts
const mockMailQueueService = {
  queueWelcome: jest.fn(),
};
```

Replace the provider registration:
```ts
        { provide: MailService, useValue: mockMailService },
```
with:
```ts
        { provide: MailQueueService, useValue: mockMailQueueService },
```

Replace both occurrences of:
```ts
      expect(mockMailService.sendWelcome).toHaveBeenCalled();
```
with:
```ts
      expect(mockMailQueueService.queueWelcome).toHaveBeenCalled();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/modules/auth/application/auth.service.spec.ts`
Expected: FAIL — `AuthService` still calls `this.mailService.sendWelcome`, so `mockMailQueueService.queueWelcome` was never called.

- [ ] **Step 3: Update `AuthService`**

`src/modules/auth/application/auth.service.ts` currently has:

```ts
import { BillingService } from '@shared/billing/billing.service';
import { MailService } from '@shared/mail/mail.service';
```
and
```ts
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly billingService: BillingService,
  ) {}
```
and (in `signup`, line ~92-93):
```ts
    // TODO: trocar 'arthur.frollini@gmail.com' por user.email quando houver domínio verificado no Resend
    await this.mailService.sendWelcome('arthur.frollini@gmail.com', user.name);
```
and (in `googleAuth`, line ~153-154):
```ts
        // TODO: trocar 'arthur.frollini@gmail.com' por email quando houver domínio verificado no Resend
        await this.mailService.sendWelcome('arthur.frollini@gmail.com', name);
```

Change the import:
```ts
import { BillingService } from '@shared/billing/billing.service';
import { MailQueueService } from '@shared/mail/mail-queue.service';
```

Change the constructor:
```ts
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly jwtService: JwtService,
    private readonly mailQueueService: MailQueueService,
    private readonly billingService: BillingService,
  ) {}
```

Change the `signup` call site:
```ts
    // TODO: trocar 'arthur.frollini@gmail.com' por user.email quando houver domínio verificado no Resend
    await this.mailQueueService.queueWelcome(
      'arthur.frollini@gmail.com',
      user.name,
    );
```

Change the `googleAuth` call site:
```ts
        // TODO: trocar 'arthur.frollini@gmail.com' por email quando houver domínio verificado no Resend
        await this.mailQueueService.queueWelcome(
          'arthur.frollini@gmail.com',
          name,
        );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/modules/auth/application/auth.service.spec.ts`
Expected: PASS, same count as before this task.

- [ ] **Step 5: Update `UsersService`'s failing assertions first**

`src/modules/users/application/users.service.spec.ts` currently has:

```ts
import { MailService } from '@shared/mail/mail.service';
```
and
```ts
  let mockMailService: { sendEmailChangeConfirmation: jest.Mock };
```
and (inside `beforeEach`):
```ts
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
```
and (inside `describe('requestEmailChange', ...)`, two occurrences):
```ts
      mockMailService.sendEmailChangeConfirmation.mockResolvedValue(undefined);
```
and:
```ts
      expect(mockMailService.sendEmailChangeConfirmation).toHaveBeenCalledWith(
```

Replace the import:
```ts
import { MailQueueService } from '@shared/mail/mail-queue.service';
```

Replace the type declaration:
```ts
  let mockMailQueueService: { queueEmailChangeConfirmation: jest.Mock };
```

Replace the `beforeEach` body:
```ts
    mockMailQueueService = { queueEmailChangeConfirmation: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: mockUsersRepository },
        { provide: MailQueueService, useValue: mockMailQueueService },
        {
          provide: StorageService,
          useValue: { generateUploadUrl: jest.fn() },
        },
      ],
    }).compile();
```

Replace both:
```ts
      mockMailQueueService.queueEmailChangeConfirmation.mockResolvedValue(
        undefined,
      );
```
and:
```ts
      expect(
        mockMailQueueService.queueEmailChangeConfirmation,
      ).toHaveBeenCalledWith(
```
(keep the rest of each assertion's arguments unchanged — only the mock object name and method name change, not what's being asserted).

- [ ] **Step 6: Run it to verify it fails**

Run: `npx jest src/modules/users/application/users.service.spec.ts`
Expected: FAIL — `UsersService` still calls `this.mailService.sendEmailChangeConfirmation`.

- [ ] **Step 7: Update `UsersService`**

`src/modules/users/application/users.service.ts` currently has:

```ts
import { MailService } from '@shared/mail/mail.service';
```
and
```ts
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly mailService: MailService,
    private readonly storageService: StorageService,
  ) {}
```
and (in `requestEmailChange`, line ~115-119):
```ts
    // TODO: trocar 'arthur.frollini@gmail.com' por user.email quando houver domínio verificado no Resend
    await this.mailService.sendEmailChangeConfirmation(
      'arthur.frollini@gmail.com',
      token,
    );
```

Change the import:
```ts
import { MailQueueService } from '@shared/mail/mail-queue.service';
```

Change the constructor:
```ts
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly mailQueueService: MailQueueService,
    private readonly storageService: StorageService,
  ) {}
```

Change the call site:
```ts
    // TODO: trocar 'arthur.frollini@gmail.com' por user.email quando houver domínio verificado no Resend
    await this.mailQueueService.queueEmailChangeConfirmation(
      'arthur.frollini@gmail.com',
      token,
    );
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx jest src/modules/users/application/users.service.spec.ts`
Expected: PASS, same count as before this task.

- [ ] **Step 9: Run the full unit suite and typecheck**

```bash
npm run test:unit
npx tsc --noEmit
```

Expected: all unit tests pass, no type errors. (Do not run e2e yet — Task 5 updates the e2e specs that currently assert against `mockMailService.sendEmailChangeConfirmation` synchronously; those will fail until that task's changes land, since the call is now asynchronous via the queue.)

- [ ] **Step 10: Commit**

```bash
git add src/modules/auth/application/auth.service.ts src/modules/auth/application/auth.service.spec.ts src/modules/users/application/users.service.ts src/modules/users/application/users.service.spec.ts
git commit -m "refactor: signup/googleAuth/requestEmailChange enqueue email via MailQueueService instead of calling MailService directly"
```

---

### Task 5: e2e coverage for the real queue + worker pipeline

**Files:**
- Create: `test/helpers/queue-helper.ts`
- Modify: `test/e2e/auth.e2e-spec.ts`
- Modify: `test/e2e/users.e2e-spec.ts`

**Interfaces:**
- Consumes: `MAIL_QUEUE_NAME`, `WELCOME_JOB_NAME`, `EMAIL_CHANGE_CONFIRMATION_JOB_NAME` (Task 2's `src/shared/mail/mail-job.types.ts`), `mockMailService` (already exported from `test/helpers/create-app.ts`, unchanged — `MailService` is still the only thing e2e tests mock; the queue and worker run for real).
- Produces: `getMailQueue(app): Queue`, `waitForLatestMailJob(app, jobName): Promise<void>`, `cleanMailQueue(app): Promise<void>` — reusable by any future e2e spec that touches the mail queue.

- [ ] **Step 1: Write `test/helpers/queue-helper.ts`**

```ts
import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue, QueueEvents } from 'bullmq';
import { MAIL_QUEUE_NAME } from '../../src/shared/mail/mail-job.types';

export function getMailQueue(app: INestApplication): Queue {
  return app.get<Queue>(getQueueToken(MAIL_QUEUE_NAME));
}

export async function waitForLatestMailJob(
  app: INestApplication,
  jobName: string,
): Promise<void> {
  const queue = getMailQueue(app);
  const jobs = await queue.getJobs(
    ['completed', 'active', 'waiting', 'delayed'],
    0,
    50,
  );
  const job = jobs.find((j) => j.name === jobName);
  if (!job) {
    throw new Error(`No "${jobName}" job found on the mail queue`);
  }

  const queueEvents = new QueueEvents(MAIL_QUEUE_NAME, {
    connection: {
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
    },
  });
  await queueEvents.waitUntilReady();
  try {
    await job.waitUntilFinished(queueEvents, 10000);
  } finally {
    await queueEvents.close();
  }
}

export async function cleanMailQueue(app: INestApplication): Promise<void> {
  const queue = getMailQueue(app);
  await queue.obliterate({ force: true });
}
```

- [ ] **Step 2: Add a signup e2e test that waits for the queued welcome email**

`test/e2e/auth.e2e-spec.ts` currently imports:
```ts
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp } from '../helpers/create-app';
import { cleanDatabase } from '../helpers/db-cleaner';
import { signUpAndGetTokens, uniqueEmail } from '../helpers/auth.helper';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { RefreshTokensRepository } from '../../src/modules/auth/domain/repositories/refresh-tokens.repository';
```

Add two imports:
```ts
import { createApp, mockMailService } from '../helpers/create-app';
import { cleanMailQueue, waitForLatestMailJob } from '../helpers/queue-helper';
import { WELCOME_JOB_NAME } from '../../src/shared/mail/mail-job.types';
```
(the first line replaces the existing `import { createApp } from '../helpers/create-app';` — `mockMailService` is added to the same import, not a new one).

Add `afterEach(async () => { await cleanMailQueue(app); });` alongside the existing `afterEach(async () => { await cleanDatabase(app); });` inside the top-level `describe('Auth (e2e)', ...)` block.

Add a new test inside `describe('POST /auth/signup', ...)`, after the existing `'creates user and returns 201 with tokens'` test:

```ts
    it('queues and delivers the welcome email asynchronously', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ name: 'Arthur', email: uniqueEmail(), password: 'Test@1234' });

      expect(res.status).toBe(201);

      await waitForLatestMailJob(app, WELCOME_JOB_NAME);

      expect(mockMailService.sendWelcome).toHaveBeenCalledWith(
        'arthur.frollini@gmail.com',
        'Arthur',
      );
    });
```

- [ ] **Step 3: Fix the now-racy `requestEmailChange` e2e test**

`test/e2e/users.e2e-spec.ts` currently has, inside `describe('PATCH /users/me/email', ...)`:

```ts
    it('sends email change request and returns 204', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me/email')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ newEmail: uniqueEmail('new') });

      expect(res.status).toBe(204);
      expect(mockMailService.sendEmailChangeConfirmation).toHaveBeenCalledTimes(
        1,
      );
    });
```

This assertion is racy now that the email is sent via an asynchronous worker instead of inline — replace it with:

```ts
    it('sends email change request and returns 204', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me/email')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ newEmail: uniqueEmail('new') });

      expect(res.status).toBe(204);

      await waitForLatestMailJob(app, EMAIL_CHANGE_CONFIRMATION_JOB_NAME);

      expect(mockMailService.sendEmailChangeConfirmation).toHaveBeenCalledTimes(
        1,
      );
    });
```

Add the required imports at the top of the file — it currently has:
```ts
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp, mockMailService } from '../helpers/create-app';
import { cleanDatabase } from '../helpers/db-cleaner';
import { signUpAndGetTokens, uniqueEmail } from '../helpers/auth.helper';
import { PrismaService } from '../../src/shared/database/prisma.service';
```

Add:
```ts
import { cleanMailQueue, waitForLatestMailJob } from '../helpers/queue-helper';
import { EMAIL_CHANGE_CONFIRMATION_JOB_NAME } from '../../src/shared/mail/mail-job.types';
```

The file's top-level `beforeEach` currently reads:
```ts
  beforeEach(async () => {
    await cleanDatabase(app);
    jest.clearAllMocks();
    ({ accessToken } = await signUpAndGetTokens(app));
  });
```

Replace it with:
```ts
  beforeEach(async () => {
    await cleanDatabase(app);
    await cleanMailQueue(app);
    jest.clearAllMocks();
    ({ accessToken } = await signUpAndGetTokens(app));
  });
```

- [ ] **Step 4: Run the full e2e suite**

```bash
docker compose up -d
npm run test:e2e
```

Expected: all e2e tests pass, including the new/updated ones. Note the new test count (was 63 before this task).

- [ ] **Step 5: Stress-test for the keep-alive/hang class of flake**

This project has a documented history of an intermittent "Jest did not exit"/socket-reuse flake when adding new async infra to the e2e suite (see `docs/superpowers/plans/2026-07-14-coverage-95.md` and the husky/flake fix in `.superpowers/sdd/progress-*.md`). Run the e2e suite 3 times in a row to confirm the new Redis connection and BullMQ worker close cleanly on `app.close()`:

```bash
npm run test:e2e && npm run test:e2e && npm run test:e2e
```

Expected: all 3 runs pass cleanly, no "Jest did not exit" warning, no hang.

- [ ] **Step 6: Run the combined suite**

```bash
npm test
```

Expected: combined coverage report prints, no regression from the ~96.5% baseline (some drop is expected and fine — new code in `mail-queue.service.ts`/`mail.processor.ts` is unit-tested, not necessarily fully covered by e2e; this step is a sanity check, not a gate).

- [ ] **Step 7: Commit**

```bash
git add test/helpers/queue-helper.ts test/e2e/auth.e2e-spec.ts test/e2e/users.e2e-spec.ts
git commit -m "test(e2e): verify signup/requestEmailChange deliver email via the real BullMQ queue+worker"
```

---

### Task 6: Update `README.md`

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing (documentation only).

- [ ] **Step 1: Update the Prerequisites/quickstart section**

`README.md` currently has, near the top:
```
docker compose up -d
```
with no further comment on what it provisions. Find this line and the paragraph around line 133 that says:
```
E2E requires Docker running (`docker compose up -d`, which provisions both the `fincheck` and `fincheck_test` databases) and a local `.env.test` file (same shape as `.env`, fake credentials for Resend/AWS/Stripe/Google — gitignored, never used for a real network call).
```

Replace it with:
```
E2E requires Docker running (`docker compose up -d`, which provisions the `fincheck`/`fincheck_test` Postgres databases plus Redis and RedisInsight for the email retry queue) and a local `.env.test` file (same shape as `.env`, fake credentials for Resend/AWS/Stripe/Google — gitignored, never used for a real network call).
```

- [ ] **Step 2: Update the E2E bullet in the Tests section**

The `## Tests` section currently has:
```
- **E2E** (`test:e2e`) — Jest + Supertest, booting the real `AppModule` against a dedicated `fincheck_test` Postgres database (`PrismaService` is never mocked). Only `MailService`, `StorageService`, `BillingService`, and the Stripe webhook handler are replaced with mocks — everything else runs for real, including Stripe webhook signature verification (via `stripe.webhooks.generateTestHeaderString`, pure local HMAC, no network call). 61 tests across 7 spec files: auth, users, admin routes, bank-accounts, categories, transactions, billing.
```

Replace the last sentence's test count with whatever `npm run test:e2e` reported in Task 5 Step 4, and add a mention of the queue. For example (adjust the count to match the actual run):
```
- **E2E** (`test:e2e`) — Jest + Supertest, booting the real `AppModule` against a dedicated `fincheck_test` Postgres database (`PrismaService` is never mocked). Only `MailService`, `StorageService`, `BillingService`, and the Stripe webhook handler are replaced with mocks — everything else runs for real, including the BullMQ email retry queue (real Redis, real worker, only the final Resend call is mocked) and Stripe webhook signature verification (via `stripe.webhooks.generateTestHeaderString`, pure local HMAC, no network call). N tests across 7 spec files: auth, users, admin routes, bank-accounts, categories, transactions, billing.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the Redis-backed email retry queue in README"
```
