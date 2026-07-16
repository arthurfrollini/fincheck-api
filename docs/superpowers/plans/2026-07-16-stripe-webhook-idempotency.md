# Stripe Webhook Idempotency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `BillingWebhookHandler` idempotent — Stripe's at-least-once delivery must never double-process an event (duplicate plan updates, duplicate notification emails) — and move billing notification emails onto the existing BullMQ mail queue so deduplication can never cause a lost email.

**Architecture:** A `processed_stripe_events` Postgres table records every handled `event.id` behind a unique constraint. The handler registers the event id FIRST (concurrent duplicates hit the unique constraint and are skipped), processes, and on failure unregisters (compensation) so Stripe's retry can reprocess. Billing emails switch from direct `MailService` calls to `MailQueueService` enqueues (never throw, retried ~24h by the worker). A daily cron prunes rows older than 30 days.

**Tech Stack:** Prisma (new model + migration), existing BullMQ mail queue (2 new job types), `@nestjs/schedule` (cleanup cron, already installed and used by `refresh-tokens-cleanup.job.ts`).

## Global Constraints

- Handler flow must be record-first + compensation: `register(event.id)` before the switch; `unregister(event.id)` + rethrow in the catch. Duplicates (`register` → `false`) return without processing.
- `register` returns `false` ONLY on Prisma error code `P2002` (unique violation); any other error propagates.
- Billing emails (`sendDowngradeNotification`, `sendSubscriptionCancelled`) must go through `MailQueueService` with the exact same job options as existing mail jobs: `attempts: EMAIL_RETRY_MAX_ATTEMPTS`, `backoff: { type: EMAIL_RETRY_BACKOFF_TYPE }`, `removeOnComplete: { age: COMPLETED_JOB_RETENTION_SECONDS }`, `removeOnFail: { age: FAILED_JOB_RETENTION_SECONDS }` (all already exported from `src/shared/mail/mail-job.types.ts`).
- `MailService` itself stays unchanged — it remains the only mail layer e2e tests mock.
- E2E must exercise the REAL `BillingWebhookHandler` (user decision): remove the `BillingWebhookHandler` override from `test/helpers/create-app.ts`; keep mocking only `MailService`, `StorageService`, `BillingService`.
- Retention: 30 days, pruned by a daily-midnight cron in the same shape as `src/modules/auth/application/refresh-tokens-cleanup.job.ts`.
- Repository follows the project's abstract-class-as-DI-token pattern, flat in `src/shared/billing/` (shared services don't use the domain/application/infra split — that's for feature modules).

---

### Task 1: `ProcessedStripeEvent` model + `StripeEventsRepository`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/shared/billing/stripe-events.repository.ts`
- Create: `src/shared/billing/stripe-events.prisma.repository.ts`
- Create: `src/shared/billing/stripe-events.prisma.repository.spec.ts`
- Modify: `src/shared/billing/billing.module.ts`
- Modify: `test/helpers/db-cleaner.ts`

**Interfaces:**
- Produces: `StripeEventsRepository` (abstract) with `register(eventId: string, type: string): Promise<boolean>`, `unregister(eventId: string): Promise<void>`, `deleteOlderThan(date: Date): Promise<void>` — Tasks 3 and 4 inject this token. Prisma model `ProcessedStripeEvent` (table `processed_stripe_events`).

- [ ] **Step 1: Add the model to `prisma/schema.prisma`**

Append after the `Transaction` model:

```prisma
model ProcessedStripeEvent {
  id          String   @id @default(uuid()) @db.Uuid
  eventId     String   @unique @map("event_id")
  type        String
  processedAt DateTime @default(now()) @map("processed_at")

  @@map("processed_stripe_events")
}
```

- [ ] **Step 2: Create and apply the migration**

```bash
npx prisma migrate dev --name add-processed-stripe-events
```

Expected: migration created under `prisma/migrations/`, applied to the dev DB, Prisma client regenerated. (The test DB picks it up automatically — `test/global-setup.ts` runs `prisma migrate deploy` before every e2e run.)

- [ ] **Step 3: Write the failing repository spec**

Create `src/shared/billing/stripe-events.prisma.repository.spec.ts`:

```ts
import { Prisma } from '@prisma/client';
import { StripeEventsPrismaRepository } from './stripe-events.prisma.repository';
import { PrismaService } from '@shared/database/prisma.service';

const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
  code: 'P2002',
  clientVersion: '6.19.3',
});

describe('StripeEventsPrismaRepository', () => {
  let mockPrisma: {
    processedStripeEvent: {
      create: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let repository: StripeEventsPrismaRepository;

  beforeEach(() => {
    mockPrisma = {
      processedStripeEvent: {
        create: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
    };
    repository = new StripeEventsPrismaRepository(
      mockPrisma as unknown as PrismaService,
    );
  });

  describe('register', () => {
    it('returns true when the event is new', async () => {
      await expect(
        repository.register('evt_1', 'customer.subscription.deleted'),
      ).resolves.toBe(true);
      expect(mockPrisma.processedStripeEvent.create).toHaveBeenCalledWith({
        data: { eventId: 'evt_1', type: 'customer.subscription.deleted' },
      });
    });

    it('returns false on a unique violation (P2002 — duplicate event)', async () => {
      mockPrisma.processedStripeEvent.create.mockRejectedValueOnce(p2002);
      await expect(repository.register('evt_1', 'x')).resolves.toBe(false);
    });

    it('rethrows any other error', async () => {
      mockPrisma.processedStripeEvent.create.mockRejectedValueOnce(
        new Error('db down'),
      );
      await expect(repository.register('evt_1', 'x')).rejects.toThrow(
        'db down',
      );
    });
  });

  it('unregister deletes by eventId', async () => {
    await repository.unregister('evt_1');
    expect(mockPrisma.processedStripeEvent.delete).toHaveBeenCalledWith({
      where: { eventId: 'evt_1' },
    });
  });

  it('deleteOlderThan prunes by processedAt', async () => {
    const cutoff = new Date('2026-06-16');
    await repository.deleteOlderThan(cutoff);
    expect(mockPrisma.processedStripeEvent.deleteMany).toHaveBeenCalledWith({
      where: { processedAt: { lt: cutoff } },
    });
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx jest src/shared/billing/stripe-events.prisma.repository.spec.ts`
Expected: FAIL with "Cannot find module './stripe-events.prisma.repository'"

- [ ] **Step 5: Write the abstract contract**

Create `src/shared/billing/stripe-events.repository.ts`:

```ts
export abstract class StripeEventsRepository {
  /**
   * Records a Stripe event id as processed. Returns false when the event
   * was already registered (unique violation) — i.e. a duplicate delivery.
   */
  abstract register(eventId: string, type: string): Promise<boolean>;
  abstract unregister(eventId: string): Promise<void>;
  abstract deleteOlderThan(date: Date): Promise<void>;
}
```

- [ ] **Step 6: Write the Prisma implementation**

Create `src/shared/billing/stripe-events.prisma.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { StripeEventsRepository } from './stripe-events.repository';

@Injectable()
export class StripeEventsPrismaRepository implements StripeEventsRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async register(eventId: string, type: string): Promise<boolean> {
    try {
      await this.prismaService.processedStripeEvent.create({
        data: { eventId, type },
      });
      return true;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return false;
      }
      throw err;
    }
  }

  async unregister(eventId: string): Promise<void> {
    await this.prismaService.processedStripeEvent.delete({
      where: { eventId },
    });
  }

  async deleteOlderThan(date: Date): Promise<void> {
    await this.prismaService.processedStripeEvent.deleteMany({
      where: { processedAt: { lt: date } },
    });
  }
}
```

- [ ] **Step 7: Run the spec to verify it passes**

Run: `npx jest src/shared/billing/stripe-events.prisma.repository.spec.ts`
Expected: PASS, 5/5

- [ ] **Step 8: Bind the repository in `src/shared/billing/billing.module.ts`**

The file currently reads:

```ts
import { Global, Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingWebhookHandler } from './billing.webhook';
import { BillingController } from './billing.controller';
import { UsersModule } from '@modules/users/users.module';

@Global()
@Module({
  imports: [UsersModule],
  controllers: [BillingController],
  providers: [BillingService, BillingWebhookHandler],
  exports: [BillingService],
})
export class BillingModule {}
```

Replace with:

```ts
import { Global, Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingWebhookHandler } from './billing.webhook';
import { BillingController } from './billing.controller';
import { StripeEventsRepository } from './stripe-events.repository';
import { StripeEventsPrismaRepository } from './stripe-events.prisma.repository';
import { UsersModule } from '@modules/users/users.module';

@Global()
@Module({
  imports: [UsersModule],
  controllers: [BillingController],
  providers: [
    BillingService,
    BillingWebhookHandler,
    {
      provide: StripeEventsRepository,
      useClass: StripeEventsPrismaRepository,
    },
  ],
  exports: [BillingService],
})
export class BillingModule {}
```

- [ ] **Step 9: Add the new table to `test/helpers/db-cleaner.ts`**

The file currently reads:

```ts
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/shared/database/prisma.service';

export async function cleanDatabase(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);
  await prisma.$transaction([
    prisma.transaction.deleteMany(),
    prisma.category.deleteMany(),
    prisma.bankAccount.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}
```

Add `processedStripeEvent` (no FK dependencies, position doesn't matter — put it first):

```ts
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/shared/database/prisma.service';

export async function cleanDatabase(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);
  await prisma.$transaction([
    prisma.processedStripeEvent.deleteMany(),
    prisma.transaction.deleteMany(),
    prisma.category.deleteMany(),
    prisma.bankAccount.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}
```

- [ ] **Step 10: Full unit suite + typecheck**

```bash
npm run test:unit
npx tsc --noEmit
```

Expected: all pass (5 new), no type errors.

- [ ] **Step 11: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/shared/billing/stripe-events.repository.ts src/shared/billing/stripe-events.prisma.repository.ts src/shared/billing/stripe-events.prisma.repository.spec.ts src/shared/billing/billing.module.ts test/helpers/db-cleaner.ts
git commit -m "feat: add ProcessedStripeEvent model and StripeEventsRepository for webhook dedup"
```

---

### Task 2: Billing email jobs on the mail queue

**Files:**
- Modify: `src/shared/mail/mail-job.types.ts`
- Modify: `src/shared/mail/mail-queue.service.ts`
- Modify: `src/shared/mail/mail-queue.service.spec.ts`
- Modify: `src/shared/mail/mail.processor.ts`
- Modify: `src/shared/mail/mail.processor.spec.ts`

**Interfaces:**
- Consumes: existing `MailService.sendDowngradeNotification(to, name, newPlan)` and `MailService.sendSubscriptionCancelled(to, name)` (unchanged), existing retry/retention constants in `mail-job.types.ts`.
- Produces: `MailQueueService.queueDowngradeNotification(to: string, name: string, newPlan: string): Promise<void>` and `MailQueueService.queueSubscriptionCancelled(to: string, name: string): Promise<void>` — Task 3 calls these. Job name constants `DOWNGRADE_NOTIFICATION_JOB_NAME = 'downgrade-notification'`, `SUBSCRIPTION_CANCELLED_JOB_NAME = 'subscription-cancelled'` — Task 5's e2e imports the latter.

- [ ] **Step 1: Add job names + data interfaces to `src/shared/mail/mail-job.types.ts`**

Append to the constants block (after `EMAIL_CHANGE_CONFIRMATION_JOB_NAME`):

```ts
export const DOWNGRADE_NOTIFICATION_JOB_NAME = 'downgrade-notification';
export const SUBSCRIPTION_CANCELLED_JOB_NAME = 'subscription-cancelled';
```

Append after `EmailChangeConfirmationJobData`:

```ts
export interface DowngradeNotificationJobData {
  to: string;
  name: string;
  newPlan: string;
}

export interface SubscriptionCancelledJobData {
  to: string;
  name: string;
}
```

- [ ] **Step 2: Write the failing specs**

In `src/shared/mail/mail-queue.service.spec.ts`, extend the import from `./mail-job.types` with `DOWNGRADE_NOTIFICATION_JOB_NAME, SUBSCRIPTION_CANCELLED_JOB_NAME`, then add inside `describe('MailQueueService', ...)` after the existing enqueue tests:

```ts
  it('enqueues a downgrade-notification job with the retry config', async () => {
    await service.queueDowngradeNotification(
      'user@example.com',
      'Arthur',
      'GOLD',
    );

    expect(mockQueue.add).toHaveBeenCalledWith(
      DOWNGRADE_NOTIFICATION_JOB_NAME,
      { to: 'user@example.com', name: 'Arthur', newPlan: 'GOLD' },
      EXPECTED_JOB_OPTIONS,
    );
  });

  it('enqueues a subscription-cancelled job with the retry config', async () => {
    await service.queueSubscriptionCancelled('user@example.com', 'Arthur');

    expect(mockQueue.add).toHaveBeenCalledWith(
      SUBSCRIPTION_CANCELLED_JOB_NAME,
      { to: 'user@example.com', name: 'Arthur' },
      EXPECTED_JOB_OPTIONS,
    );
  });
```

In `src/shared/mail/mail.processor.spec.ts`, extend the `mockMailService` object with the two methods and the import with the two new job names:

```ts
    mockMailService = {
      sendWelcome: jest.fn().mockResolvedValue(undefined),
      sendEmailChangeConfirmation: jest.fn().mockResolvedValue(undefined),
      sendDowngradeNotification: jest.fn().mockResolvedValue(undefined),
      sendSubscriptionCancelled: jest.fn().mockResolvedValue(undefined),
    };
```

(also widen the `Pick<MailService, ...>` type on the mock declaration to include `'sendDowngradeNotification' | 'sendSubscriptionCancelled'`), then add:

```ts
  it('calls sendDowngradeNotification for a downgrade-notification job', async () => {
    const job = makeJob(DOWNGRADE_NOTIFICATION_JOB_NAME, {
      to: 'user@example.com',
      name: 'Arthur',
      newPlan: 'GOLD',
    });

    await processor.process(job);

    expect(mockMailService.sendDowngradeNotification).toHaveBeenCalledWith(
      'user@example.com',
      'Arthur',
      'GOLD',
    );
  });

  it('calls sendSubscriptionCancelled for a subscription-cancelled job', async () => {
    const job = makeJob(SUBSCRIPTION_CANCELLED_JOB_NAME, {
      to: 'user@example.com',
      name: 'Arthur',
    });

    await processor.process(job);

    expect(mockMailService.sendSubscriptionCancelled).toHaveBeenCalledWith(
      'user@example.com',
      'Arthur',
    );
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest src/shared/mail/`
Expected: the 4 new tests FAIL (methods/branches don't exist); existing tests still pass.

- [ ] **Step 4: Implement**

In `src/shared/mail/mail-queue.service.ts`, extend the import from `./mail-job.types` with `DOWNGRADE_NOTIFICATION_JOB_NAME, SUBSCRIPTION_CANCELLED_JOB_NAME, DowngradeNotificationJobData, SubscriptionCancelledJobData` and add after `queueEmailChangeConfirmation`:

```ts
  async queueDowngradeNotification(
    to: string,
    name: string,
    newPlan: string,
  ): Promise<void> {
    await this.enqueue<DowngradeNotificationJobData>(
      DOWNGRADE_NOTIFICATION_JOB_NAME,
      { to, name, newPlan },
    );
  }

  async queueSubscriptionCancelled(to: string, name: string): Promise<void> {
    await this.enqueue<SubscriptionCancelledJobData>(
      SUBSCRIPTION_CANCELLED_JOB_NAME,
      { to, name },
    );
  }
```

In `src/shared/mail/mail.processor.ts`, extend the import from `./mail-job.types` the same way and add before the final `throw` in `process()`:

```ts
    if (job.name === DOWNGRADE_NOTIFICATION_JOB_NAME) {
      const { to, name, newPlan } = job.data as DowngradeNotificationJobData;
      await this.mailService.sendDowngradeNotification(to, name, newPlan);
      return;
    }

    if (job.name === SUBSCRIPTION_CANCELLED_JOB_NAME) {
      const { to, name } = job.data as SubscriptionCancelledJobData;
      await this.mailService.sendSubscriptionCancelled(to, name);
      return;
    }
```

- [ ] **Step 5: Run to verify pass + typecheck**

```bash
npx jest src/shared/mail/
npx tsc --noEmit
```

Expected: all mail specs pass (4 new), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/mail/mail-job.types.ts src/shared/mail/mail-queue.service.ts src/shared/mail/mail-queue.service.spec.ts src/shared/mail/mail.processor.ts src/shared/mail/mail.processor.spec.ts
git commit -m "feat: add downgrade/cancellation billing emails as mail queue job types"
```

---

### Task 3: Idempotent `BillingWebhookHandler`

**Files:**
- Modify: `src/shared/billing/billing.webhook.ts`
- Modify: `src/shared/billing/billing.webhook.spec.ts`

**Interfaces:**
- Consumes: `StripeEventsRepository.register/unregister` (Task 1), `MailQueueService.queueDowngradeNotification/queueSubscriptionCancelled` (Task 2).
- Produces: nothing new for later tasks — behavior change only.

- [ ] **Step 1: Update the spec first (failing)**

`src/shared/billing/billing.webhook.spec.ts` currently mocks `MailService` (`mockMailService` with `sendDowngradeNotification`/`sendSubscriptionCancelled`) and registers `{ provide: MailService, useValue: mockMailService }`. Rework it:

1. Replace the `MailService` import with `import { MailQueueService } from '@shared/mail/mail-queue.service';` and add `import { StripeEventsRepository } from './stripe-events.repository';`.
2. Rename the mock and its methods:

```ts
const mockMailQueueService = {
  queueDowngradeNotification: jest.fn(),
  queueSubscriptionCancelled: jest.fn(),
};

const mockStripeEventsRepository = {
  register: jest.fn(),
  unregister: jest.fn(),
};
```

3. Provider array: replace the `MailService` line with the two mocks:

```ts
        { provide: MailQueueService, useValue: mockMailQueueService },
        { provide: StripeEventsRepository, useValue: mockStripeEventsRepository },
```

4. In the suite's `beforeEach` (after `jest.clearAllMocks()` if present, otherwise at the end of the existing setup), default the register mock to "new event":

```ts
    mockStripeEventsRepository.register.mockResolvedValue(true);
```

5. Mechanically rename every assertion: `mockMailService.sendDowngradeNotification` → `mockMailQueueService.queueDowngradeNotification`, `mockMailService.sendSubscriptionCancelled` → `mockMailQueueService.queueSubscriptionCancelled`. The asserted argument lists stay identical (`(email, name, newPlan)` / `(email, name)`).
6. Add a new `describe('idempotency', ...)` block at the end of the top-level describe:

```ts
  describe('idempotency', () => {
    it('registers the event id before processing', async () => {
      mockUsersRepository.findByStripeCustomerId.mockResolvedValue(null);
      const event = {
        id: 'evt_123',
        type: 'customer.subscription.deleted',
        data: { object: { customer: 'cus_1' } },
      } as unknown as Stripe.Event;

      await handler.handle(event);

      expect(mockStripeEventsRepository.register).toHaveBeenCalledWith(
        'evt_123',
        'customer.subscription.deleted',
      );
    });

    it('skips processing entirely on a duplicate delivery', async () => {
      mockStripeEventsRepository.register.mockResolvedValue(false);
      const event = {
        id: 'evt_dup',
        type: 'customer.subscription.deleted',
        data: { object: { customer: 'cus_1' } },
      } as unknown as Stripe.Event;

      await handler.handle(event);

      expect(
        mockUsersRepository.findByStripeCustomerId,
      ).not.toHaveBeenCalled();
      expect(mockUsersRepository.update).not.toHaveBeenCalled();
      expect(
        mockMailQueueService.queueSubscriptionCancelled,
      ).not.toHaveBeenCalled();
    });

    it('unregisters the event and rethrows when processing fails', async () => {
      mockUsersRepository.findByStripeCustomerId.mockRejectedValue(
        new Error('db down'),
      );
      const event = {
        id: 'evt_fail',
        type: 'customer.subscription.deleted',
        data: { object: { customer: 'cus_1' } },
      } as unknown as Stripe.Event;

      await expect(handler.handle(event)).rejects.toThrow('db down');
      expect(mockStripeEventsRepository.unregister).toHaveBeenCalledWith(
        'evt_fail',
      );
    });
  });
```

Adapt mock/user fixture names to whatever the existing spec file actually uses (read it first) — the shapes above show the required assertions, not necessarily the file's exact fixture helpers.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/shared/billing/billing.webhook.spec.ts`
Expected: FAIL — handler still injects `MailService` and has no dedup.

- [ ] **Step 3: Rewrite the handler**

`src/shared/billing/billing.webhook.ts` — change imports, constructor, `handle()`, and the three email call sites. Final state:

```ts
import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { UsersRepository } from '@modules/users/domain/repositories/users.repository';
import { MailQueueService } from '@shared/mail/mail-queue.service';
import { Plan } from '@modules/users/entities/User';
import { env } from '@shared/config/env';
import { StripeEventsRepository } from './stripe-events.repository';

@Injectable()
export class BillingWebhookHandler {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly mailQueueService: MailQueueService,
    private readonly stripeEventsRepository: StripeEventsRepository,
  ) {}

  async handle(event: Stripe.Event): Promise<void> {
    // Record-first: a concurrent duplicate delivery hits the unique
    // constraint here and is skipped — no double-processing window.
    const isNew = await this.stripeEventsRepository.register(
      event.id,
      event.type,
    );
    if (!isNew) return;

    try {
      switch (event.type) {
        case 'invoice.payment_succeeded':
          await this.onInvoicePaymentSucceeded(event);
          break;
        case 'customer.subscription.deleted':
          await this.onSubscriptionDeleted(event);
          break;
        case 'customer.subscription.updated':
          await this.onSubscriptionUpdated(event);
          break;
      }
    } catch (err) {
      // Compensation: a real processing failure must not burn the event —
      // removing the record lets Stripe's retry reprocess from scratch.
      await this.stripeEventsRepository.unregister(event.id);
      throw err;
    }
  }

  private planFromPriceId(priceId: string): Plan {
    if (priceId === env.stripePriceGold) return Plan.GOLD;
    if (priceId === env.stripePricePlatinum) return Plan.PLATINUM;
    return Plan.FREE;
  }

  private async onInvoicePaymentSucceeded(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId = invoice.customer as string;

    const user = await this.usersRepository.findByStripeCustomerId(customerId);
    if (!user) return;

    const lineItem = invoice.lines.data[0];
    const priceRef = lineItem?.pricing?.price_details?.price;
    const priceId = typeof priceRef === 'string' ? priceRef : priceRef?.id;
    if (!priceId) return;

    const newPlan = this.planFromPriceId(priceId);
    const isDowngrade =
      (user.plan === Plan.PLATINUM && newPlan === Plan.GOLD) ||
      (user.plan !== Plan.FREE && newPlan === Plan.FREE);

    await this.usersRepository.update(user.id, { plan: newPlan });

    if (isDowngrade) {
      await this.mailQueueService.queueDowngradeNotification(
        user.email,
        user.name,
        newPlan,
      );
    }
  }

  private async onSubscriptionDeleted(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = subscription.customer as string;

    const user = await this.usersRepository.findByStripeCustomerId(customerId);
    if (!user) return;

    await this.usersRepository.update(user.id, {
      plan: Plan.FREE,
      stripePriceId: null,
    });

    await this.mailQueueService.queueSubscriptionCancelled(
      user.email,
      user.name,
    );
  }

  private async onSubscriptionUpdated(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = subscription.customer as string;

    if (subscription.status !== 'active' || subscription.cancel_at_period_end)
      return;

    const user = await this.usersRepository.findByStripeCustomerId(customerId);
    if (!user) return;

    const priceId = subscription.items.data[0]?.price?.id;
    if (!priceId) return;

    const newPlan = this.planFromPriceId(priceId);
    await this.usersRepository.update(user.id, {
      plan: newPlan,
      stripePriceId: priceId,
    });

    const isDowngrade =
      (user.plan === Plan.PLATINUM && newPlan === Plan.GOLD) ||
      (user.plan !== Plan.FREE && newPlan === Plan.FREE);

    if (isDowngrade) {
      await this.mailQueueService.queueDowngradeNotification(
        user.email,
        user.name,
        newPlan,
      );
    }
  }
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npx jest src/shared/billing/billing.webhook.spec.ts
npm run test:unit
npx tsc --noEmit
```

Expected: webhook spec passes (3 new idempotency tests + all renamed assertions), full unit suite green, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/billing/billing.webhook.ts src/shared/billing/billing.webhook.spec.ts
git commit -m "feat: dedupe Stripe webhook events (record-first + compensation), billing emails via queue"
```

---

### Task 4: Retention cron for processed events

**Files:**
- Create: `src/shared/billing/stripe-events-cleanup.job.ts`
- Create: `src/shared/billing/stripe-events-cleanup.job.spec.ts`
- Modify: `src/shared/billing/billing.module.ts`

**Interfaces:**
- Consumes: `StripeEventsRepository.deleteOlderThan(date)` (Task 1).
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing spec**

Create `src/shared/billing/stripe-events-cleanup.job.spec.ts`:

```ts
import { StripeEventsCleanupJob } from './stripe-events-cleanup.job';
import { StripeEventsRepository } from './stripe-events.repository';

describe('StripeEventsCleanupJob', () => {
  it('deletes events older than 30 days', async () => {
    const mockRepository = { deleteOlderThan: jest.fn() };
    const job = new StripeEventsCleanupJob(
      mockRepository as unknown as StripeEventsRepository,
    );

    const before = Date.now();
    await job.handle();
    const after = Date.now();

    expect(mockRepository.deleteOlderThan).toHaveBeenCalledTimes(1);
    const cutoff = mockRepository.deleteOlderThan.mock.calls[0][0] as Date;
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - thirtyDaysMs);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after - thirtyDaysMs);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/shared/billing/stripe-events-cleanup.job.spec.ts`
Expected: FAIL with "Cannot find module './stripe-events-cleanup.job'"

- [ ] **Step 3: Implement**

Create `src/shared/billing/stripe-events-cleanup.job.ts` (same shape as `src/modules/auth/application/refresh-tokens-cleanup.job.ts`):

```ts
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StripeEventsRepository } from './stripe-events.repository';

// Stripe redelivers failed webhooks for up to ~3 days; 30 days of dedup
// history is a comfortable margin while keeping the table from growing
// forever (same class of concern as the Redis job-retention caps).
const RETENTION_DAYS = 30;

@Injectable()
export class StripeEventsCleanupJob {
  constructor(
    private readonly stripeEventsRepository: StripeEventsRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handle() {
    const cutoff = new Date(
      Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.stripeEventsRepository.deleteOlderThan(cutoff);
  }
}
```

- [ ] **Step 4: Register in `src/shared/billing/billing.module.ts`**

Add the import and append `StripeEventsCleanupJob` to the `providers` array (after the repository binding from Task 1):

```ts
import { StripeEventsCleanupJob } from './stripe-events-cleanup.job';
```

```ts
  providers: [
    BillingService,
    BillingWebhookHandler,
    {
      provide: StripeEventsRepository,
      useClass: StripeEventsPrismaRepository,
    },
    StripeEventsCleanupJob,
  ],
```

- [ ] **Step 5: Run to verify pass**

```bash
npx jest src/shared/billing/
npx tsc --noEmit
```

Expected: all billing specs pass (1 new), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/billing/stripe-events-cleanup.job.ts src/shared/billing/stripe-events-cleanup.job.spec.ts src/shared/billing/billing.module.ts
git commit -m "feat: prune processed Stripe events older than 30 days via daily cron"
```

---

### Task 5: E2E — real handler, duplicate delivery deduped

**Files:**
- Modify: `test/helpers/create-app.ts`
- Modify: `test/e2e/billing.e2e-spec.ts`

**Interfaces:**
- Consumes: `SUBSCRIPTION_CANCELLED_JOB_NAME` (Task 2), `waitForLatestMailJob`/`cleanMailQueue` (existing, `test/helpers/queue-helper.ts`), `mockMailService.sendSubscriptionCancelled` (already exported by `create-app.ts`, unchanged).
- Produces: nothing — final behavioral proof.

- [ ] **Step 1: Remove the `BillingWebhookHandler` mock from `test/helpers/create-app.ts`**

Delete the `mockBillingWebhookHandler` export:

```ts
export const mockBillingWebhookHandler = {
  handle: jest.fn().mockResolvedValue(undefined),
};
```

Delete its override in `createApp`:

```ts
    .overrideProvider(BillingWebhookHandler)
    .useValue(mockBillingWebhookHandler)
```

Delete the now-unused import of `BillingWebhookHandler`. (`MailService`, `StorageService`, `BillingService` overrides stay.) Reminder: this repo's ESLint fails on unused imports — the import MUST be removed, not left behind.

- [ ] **Step 2: Rework `test/e2e/billing.e2e-spec.ts`'s webhook block**

Update the import from `../helpers/create-app`: remove `mockBillingWebhookHandler`, add `mockMailService`. Add:

```ts
import { PrismaService } from '../../src/shared/database/prisma.service';
import { cleanMailQueue, waitForLatestMailJob } from '../helpers/queue-helper';
import { SUBSCRIPTION_CANCELLED_JOB_NAME } from '../../src/shared/mail/mail-job.types';
```

Add `await cleanMailQueue(app);` to the existing `beforeEach`, right after `cleanDatabase(app)`.

Replace the existing `'returns 200 and calls the webhook handler with a valid signature'` test (its `mockBillingWebhookHandler.handle` assertion no longer exists) with the real-pipeline tests below. The two 401 signature tests stay unchanged.

```ts
    it('processes a subscription-deleted event for real: resets plan and queues the email', async () => {
      // Give the signed-up user a Stripe customer id + a paid plan so the
      // cancellation event has something to act on.
      const prisma = app.get(PrismaService);
      const user = await prisma.user.findFirstOrThrow();
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: 'cus_e2e_test', plan: 'GOLD' },
      });
      mockMailService.sendSubscriptionCancelled.mockClear();

      const event = {
        id: 'evt_e2e_deleted_1',
        object: 'event',
        type: 'customer.subscription.deleted',
        data: { object: { customer: 'cus_e2e_test' } },
      };
      const { payload, header } = signedPayload(event);

      const res = await request(app.getHttpServer())
        .post('/billing/webhook')
        .set('stripe-signature', header)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(res.status).toBe(200);

      const updated = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(updated.plan).toBe('FREE');
      expect(updated.stripePriceId).toBeNull();

      await waitForLatestMailJob(app, SUBSCRIPTION_CANCELLED_JOB_NAME);
      expect(mockMailService.sendSubscriptionCancelled).toHaveBeenCalledTimes(
        1,
      );

      const dedupRow = await prisma.processedStripeEvent.findUnique({
        where: { eventId: 'evt_e2e_deleted_1' },
      });
      expect(dedupRow).not.toBeNull();
    });

    it('deduplicates a duplicate delivery: second POST is a no-op', async () => {
      const prisma = app.get(PrismaService);
      const user = await prisma.user.findFirstOrThrow();
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: 'cus_e2e_dup', plan: 'GOLD' },
      });
      mockMailService.sendSubscriptionCancelled.mockClear();

      const event = {
        id: 'evt_e2e_duplicate',
        object: 'event',
        type: 'customer.subscription.deleted',
        data: { object: { customer: 'cus_e2e_dup' } },
      };
      const { payload, header } = signedPayload(event);

      const first = await request(app.getHttpServer())
        .post('/billing/webhook')
        .set('stripe-signature', header)
        .set('Content-Type', 'application/json')
        .send(payload);
      expect(first.status).toBe(200);

      await waitForLatestMailJob(app, SUBSCRIPTION_CANCELLED_JOB_NAME);

      // Same exact signed payload again — Stripe redelivery.
      const second = await request(app.getHttpServer())
        .post('/billing/webhook')
        .set('stripe-signature', header)
        .set('Content-Type', 'application/json')
        .send(payload);
      expect(second.status).toBe(200);

      // Give the worker a beat: if a second job HAD been enqueued, it would
      // process within this window and break the call-count assertion.
      await new Promise((r) => setTimeout(r, 1500));

      expect(mockMailService.sendSubscriptionCancelled).toHaveBeenCalledTimes(
        1,
      );
      const rows = await prisma.processedStripeEvent.findMany({
        where: { eventId: 'evt_e2e_duplicate' },
      });
      expect(rows).toHaveLength(1);
    });
```

Note on `signedPayload`: the existing helper signs the exact payload string — reusing the same `{ payload, header }` pair for both POSTs is intentional (Stripe re-sends the same signed body; the timestamp tolerance is minutes, well beyond this test's duration).

- [ ] **Step 3: Run the billing e2e spec**

```bash
docker compose up -d
npx jest --config ./test/jest-e2e.json --coverage=false test/e2e/billing.e2e-spec.ts
```

Expected: PASS (2 new tests replacing 1 removed; net count +1 in this file).

- [ ] **Step 4: Full suite**

```bash
npm test
```

Expected: exit 0. Removing the `BillingWebhookHandler` mock affects only the billing spec (verify no other spec imports `mockBillingWebhookHandler` — grep first; as of writing only `billing.e2e-spec.ts` does). Note the new total e2e count for Task 6.

- [ ] **Step 5: Commit**

```bash
git add test/helpers/create-app.ts test/e2e/billing.e2e-spec.ts
git commit -m "test(e2e): exercise the real webhook handler — duplicate Stripe delivery is deduped"
```

---

### Task 6: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document idempotency in the Billing Flow section**

`README.md`'s `## Billing Flow (Stripe)` section ends with:

```
Webhook endpoint: `POST /billing/webhook` — validates Stripe signature via `rawBody`.
```

Replace that line with:

```
Webhook endpoint: `POST /billing/webhook` — validates Stripe signature via `rawBody`. Processing is idempotent: every `event.id` is recorded in `processed_stripe_events` (record-first, compensating delete on failure), so Stripe's at-least-once redelivery never double-applies plan changes or duplicates notification emails. Billing emails go through the same Redis-backed retry queue as signup/email-change. Dedup rows are pruned after 30 days by a daily cron.
```

- [ ] **Step 2: Update test counts**

In the `## Tests` section, update the e2e count in the E2E bullet (`66 tests across 8 spec files: ...`) to whatever `npm test` reported in Task 5 Step 4, and the unit count in the Unit bullet + Stack line if it changed (Tasks 1-4 added unit tests: 5 repository + 4 mail + 3 webhook idempotency + 1 cron = expect 141 → ~154; verify against the actual run).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document Stripe webhook idempotency in README"
```
