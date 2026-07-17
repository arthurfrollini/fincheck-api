# Final Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three remaining hardening items from the error-handling audit — a request timeout on every Resend call, a single injected Stripe client with webhook signature verification moved out of the controller, and an allowlist on the avatar `ext` query param.

**Architecture:** Three independent parts in one PR. Part 1 adds `AbortSignal.timeout` to `MailService`'s sends. Part 2 replaces the two `new Stripe()` instances with one `STRIPE_CLIENT` DI provider. Part 3 moves `webhooks.constructEvent` into `BillingWebhookHandler` and thins the controller. Part 4 validates `ext` via a DTO. Each has its own tests.

**Tech Stack:** native `AbortSignal.timeout` (Node 20), NestJS custom provider (`useFactory` + injection token), `class-validator` `@IsIn`, existing Jest/Supertest suites.

## Global Constraints

- `RESEND_TIMEOUT_MS = 10000`; every `this.resend.emails.send(payload)` call passes `{ signal: AbortSignal.timeout(RESEND_TIMEOUT_MS) }` as the second argument.
- One Stripe instance via `STRIPE_CLIENT` injection token (a `Symbol`); `BillingService` and `BillingWebhookHandler` inject it with `@Inject(STRIPE_CLIENT)` instead of `new Stripe(...)`. No `new Stripe()` may remain in `billing.controller.ts`, `billing.service.ts`, or `billing.webhook.ts`.
- Signature verification lives in `BillingWebhookHandler.constructEvent(rawBody, signature): Stripe.Event`, throwing `UnauthorizedException('Invalid webhook signature.')` on failure (exact existing message). The controller keeps throwing `UnauthorizedException('Missing stripe-signature header.')` for a missing header.
- `billing.controller.ts` must not import `Stripe` or reference `env.stripeWebhookSecret` after Part 3. This repo's ESLint fails the build on unused imports — remove them.
- Avatar `ext` allowlist: exactly `['jpg', 'jpeg', 'png', 'webp']`, validated via `@IsIn`, rejected with 400 by the global `ValidationPipe` (`whitelist: true, transform: true`, already configured).
- `handle(event)` (idempotency logic from #25) and `MailService`'s email bodies stay behaviorally unchanged — this plan only adds a timeout arg, swaps Stripe construction for injection, moves verification, and validates a query param.

---

### Task 1: Resend request timeout

**Files:**
- Modify: `src/shared/mail/mail.service.ts`
- Modify: `src/shared/mail/mail.service.spec.ts`

**Interfaces:**
- Produces: nothing consumed by later tasks (self-contained).

- [ ] **Step 1: Update the spec to require the timeout signal**

`src/shared/mail/mail.service.spec.ts` has four tests, each asserting `sendMock` was called with a single `expect.objectContaining({...})` payload. Change every one of the four `toHaveBeenCalledWith(...)` assertions to add a second argument matcher. For example, the `sendEmailChangeConfirmation` assertion becomes:

```ts
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'noreply@fincheck.test',
          to: 'user@example.com',
          subject: 'Confirme a alteração do seu e-mail',
          html: expect.stringContaining(
            'http://localhost:3000/users/confirm-email?token=abc-token-123',
          ),
        }),
        { signal: expect.any(AbortSignal) },
      );
```

Apply the same second argument (`{ signal: expect.any(AbortSignal) }`) to the `sendWelcome`, `sendDowngradeNotification`, and `sendSubscriptionCancelled` assertions — keep each test's existing first-argument matcher exactly as it is, only append the second argument.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/shared/mail/mail.service.spec.ts`
Expected: FAIL — `send` is currently called with one argument, so the two-argument matcher doesn't match.

- [ ] **Step 3: Add the timeout to `mail.service.ts`**

At the top of `src/shared/mail/mail.service.ts`, after the imports, add the constant:

```ts
const RESEND_TIMEOUT_MS = 10000;
```

Then add `, { signal: AbortSignal.timeout(RESEND_TIMEOUT_MS) }` as the second argument to each of the four `this.resend.emails.send({...})` calls. Each call currently ends with `});` — it becomes `}, { signal: AbortSignal.timeout(RESEND_TIMEOUT_MS) });`. For example `sendWelcome`:

```ts
  async sendWelcome(to: string, name: string) {
    await this.resend.emails.send(
      {
        from: env.resendFromEmail,
        to,
        subject: 'Bem-vindo ao Fincheck!',
        html: `
        <h1>Olá, ${name}!</h1>
        <p>Sua conta foi criada com sucesso. Seja bem-vindo ao Fincheck.</p>
        <p>Comece agora a organizar suas finanças.</p>
      `,
      },
      { signal: AbortSignal.timeout(RESEND_TIMEOUT_MS) },
    );
  }
```

Do the same for `sendEmailChangeConfirmation`, `sendDowngradeNotification`, and `sendSubscriptionCancelled` — same second argument, email body content unchanged.

- [ ] **Step 4: Run to verify pass + typecheck**

```bash
npx jest src/shared/mail/mail.service.spec.ts
npx tsc --noEmit
```

Expected: all mail.service tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/mail/mail.service.ts src/shared/mail/mail.service.spec.ts
git commit -m "fix: add a 10s request timeout to all Resend calls so a hung send can't stall the worker"
```

---

### Task 2: Single Stripe client via `STRIPE_CLIENT` token

**Files:**
- Create: `src/shared/billing/stripe.provider.ts`
- Modify: `src/shared/billing/billing.module.ts`
- Modify: `src/shared/billing/billing.service.ts`
- Modify: `src/shared/billing/billing.service.spec.ts`
- Modify: `src/shared/billing/billing.webhook.ts`
- Modify: `src/shared/billing/billing.webhook.spec.ts`

**Interfaces:**
- Produces: `STRIPE_CLIENT` (injection token, exported from `stripe.provider.ts`) and `stripeProvider` (the `Provider` object) — Task 3 relies on `BillingWebhookHandler` having an injected `this.stripe: Stripe`.

- [ ] **Step 1: Create the provider**

Create `src/shared/billing/stripe.provider.ts`:

```ts
import { Provider } from '@nestjs/common';
import Stripe from 'stripe';
import { env } from '@shared/config/env';

export const STRIPE_CLIENT = Symbol('STRIPE_CLIENT');

export const stripeProvider: Provider = {
  provide: STRIPE_CLIENT,
  useFactory: () => new Stripe(env.stripeSecretKey),
};
```

- [ ] **Step 2: Register it in `billing.module.ts`**

Add the import and put `stripeProvider` in the providers array (before `BillingService`, since both service and handler depend on it):

```ts
import { Global, Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingWebhookHandler } from './billing.webhook';
import { BillingController } from './billing.controller';
import { StripeEventsRepository } from './stripe-events.repository';
import { StripeEventsPrismaRepository } from './stripe-events.prisma.repository';
import { StripeEventsCleanupJob } from './stripe-events-cleanup.job';
import { stripeProvider } from './stripe.provider';
import { UsersModule } from '@modules/users/users.module';

@Global()
@Module({
  imports: [UsersModule],
  controllers: [BillingController],
  providers: [
    stripeProvider,
    BillingService,
    BillingWebhookHandler,
    {
      provide: StripeEventsRepository,
      useClass: StripeEventsPrismaRepository,
    },
    StripeEventsCleanupJob,
  ],
  exports: [BillingService],
})
export class BillingModule {}
```

- [ ] **Step 3: Update `billing.service.spec.ts` first (failing)**

The spec currently mocks Stripe via `jest.mock('stripe', () => jest.fn().mockImplementation(() => mockStripe))` and constructs the service with only `UsersRepository` in providers. After the change the service injects `STRIPE_CLIENT`, so the module needs that token. Two edits:

1. Add the import near the other imports:
```ts
import { STRIPE_CLIENT } from './stripe.provider';
```

2. Add the token provider to the `Test.createTestingModule` providers array:
```ts
      providers: [
        BillingService,
        { provide: UsersRepository, useValue: mockUsersRepository },
        { provide: STRIPE_CLIENT, useValue: mockStripe },
      ],
```

Leave the existing `jest.mock('stripe', ...)` in place — it's harmless (the constructor no longer calls it, but the import of the `stripe` type remains) and removing it is out of scope.

- [ ] **Step 4: Run to verify failure**

Run: `npx jest src/shared/billing/billing.service.spec.ts`
Expected: FAIL — `BillingService` still does `new Stripe()` and doesn't accept the token, so `this.stripe` is the mock from the module-level `jest.mock` in some tests and the DI provider is unused; the failing signal is the Nest DI error for the unresolved `STRIPE_CLIENT` parameter once the service is edited. (If this step's spec edit alone doesn't fail yet, it will after Step 5's constructor change — run it again there; the TDD intent is that the token wiring and the constructor change land together.)

- [ ] **Step 5: Inject the token in `billing.service.ts`**

Change the imports and constructor. `Stripe` stays imported (used as a type). Add `Inject`:

```ts
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { UsersRepository } from '@modules/users/domain/repositories/users.repository';
import { env } from '@shared/config/env';
import { STRIPE_CLIENT } from './stripe.provider';
```

Replace the class field + constructor:

```ts
@Injectable()
export class BillingService {
  constructor(
    private readonly usersRepository: UsersRepository,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}
```

(Delete the `private readonly stripe: Stripe;` field declaration and the `this.stripe = new Stripe(env.stripeSecretKey);` line — the injected `stripe` replaces them. `env` stays imported: it's still used for `env.stripePriceGold`/`env.stripePricePlatinum`.)

- [ ] **Step 6: Run to verify the service spec passes**

Run: `npx jest src/shared/billing/billing.service.spec.ts`
Expected: PASS — all existing BillingService tests green with the injected mock.

- [ ] **Step 7: Update `billing.webhook.spec.ts` first (failing)**

The handler will gain a `STRIPE_CLIENT` constructor param. Add the token to its TestingModule. Two edits:

1. Add the import:
```ts
import { STRIPE_CLIENT } from './stripe.provider';
```

2. Add a Stripe mock object near the other mocks (it needs `webhooks.constructEvent` for Task 3; define it now so the provider is complete):
```ts
const mockStripe = {
  webhooks: { constructEvent: jest.fn() },
};
```

3. Add the provider to the handler's `Test.createTestingModule` providers array:
```ts
        { provide: STRIPE_CLIENT, useValue: mockStripe },
```

- [ ] **Step 8: Inject the token in `billing.webhook.ts`**

Add `Inject` to the `@nestjs/common` import and the constructor param (append it last, after `logger`):

```ts
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
```

```ts
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly mailQueueService: MailQueueService,
    private readonly stripeEventsRepository: StripeEventsRepository,
    @InjectPinoLogger(BillingWebhookHandler.name)
    private readonly logger: PinoLogger,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}
```

Add the import at the top:
```ts
import { STRIPE_CLIENT } from './stripe.provider';
```

`UnauthorizedException` is imported now (unused until Task 3 adds `constructEvent`) — that would trip the unused-import lint rule, so DO NOT add `UnauthorizedException` in this task. Import only `Inject` and `Injectable` here:

```ts
import { Inject, Injectable } from '@nestjs/common';
```

(Task 3 adds `UnauthorizedException` when it adds the method that uses it.)

- [ ] **Step 9: Run the billing unit suite + typecheck**

```bash
npx jest src/shared/billing/
npx tsc --noEmit
```

Expected: all billing specs pass (handler + service now use the injected token), no type errors. `new Stripe()` remains only in `stripe.provider.ts` (verify with `grep -rn "new Stripe(" src/` → one hit).

- [ ] **Step 10: Commit**

```bash
git add src/shared/billing/stripe.provider.ts src/shared/billing/billing.module.ts src/shared/billing/billing.service.ts src/shared/billing/billing.service.spec.ts src/shared/billing/billing.webhook.ts src/shared/billing/billing.webhook.spec.ts
git commit -m "refactor: inject a single shared Stripe client instead of two new Stripe() instances"
```

---

### Task 3: Move signature verification into the handler, thin the controller

**Files:**
- Modify: `src/shared/billing/billing.webhook.ts`
- Modify: `src/shared/billing/billing.webhook.spec.ts`
- Modify: `src/shared/billing/billing.controller.ts`

**Interfaces:**
- Consumes: `this.stripe` (injected in Task 2), `env.stripeWebhookSecret`.
- Produces: `BillingWebhookHandler.constructEvent(rawBody: Buffer, signature: string): Stripe.Event`.

- [ ] **Step 1: Add the failing spec for `constructEvent`**

In `src/shared/billing/billing.webhook.spec.ts`, the top-level `jest.mock('@shared/config/env', ...)` currently returns only the price keys — add `stripeWebhookSecret` so the handler can read it:

```ts
jest.mock('@shared/config/env', () => ({
  env: {
    stripePriceGold: 'price_gold',
    stripePricePlatinum: 'price_platinum',
    stripeWebhookSecret: 'whsec_test',
  },
}));
```

Add a new `describe` block (the `mockStripe` with `webhooks.constructEvent` already exists from Task 2):

```ts
  describe('constructEvent', () => {
    it('returns the parsed event when the signature is valid', () => {
      const event = { id: 'evt_1', type: 'x' } as Stripe.Event;
      mockStripe.webhooks.constructEvent.mockReturnValue(event);

      const result = handler.constructEvent(
        Buffer.from('raw'),
        'sig_valid',
      );

      expect(result).toBe(event);
      expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
        Buffer.from('raw'),
        'sig_valid',
        'whsec_test',
      );
    });

    it('throws UnauthorizedException when the signature is invalid', () => {
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('bad signature');
      });

      expect(() =>
        handler.constructEvent(Buffer.from('raw'), 'sig_bad'),
      ).toThrow(UnauthorizedException);
    });
  });
```

Add `UnauthorizedException` to the spec's `@nestjs/common` imports (it currently may not import it):

```ts
import { UnauthorizedException } from '@nestjs/common';
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/shared/billing/billing.webhook.spec.ts`
Expected: FAIL — `handler.constructEvent` is not a function.

- [ ] **Step 3: Add `constructEvent` to the handler**

In `src/shared/billing/billing.webhook.ts`, add `UnauthorizedException` to the `@nestjs/common` import:

```ts
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
```

Add the method (above `handle`, so verification reads first):

```ts
  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    try {
      return this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        env.stripeWebhookSecret,
      );
    } catch {
      throw new UnauthorizedException('Invalid webhook signature.');
    }
  }
```

- [ ] **Step 4: Run to verify the handler spec passes**

Run: `npx jest src/shared/billing/billing.webhook.spec.ts`
Expected: PASS — both new `constructEvent` tests plus all existing tests.

- [ ] **Step 5: Thin the controller**

Rewrite `src/shared/billing/billing.controller.ts`'s imports and `handleWebhook`. Remove the `Stripe` import, the `env` import, the `this.stripe` field, and the `new Stripe()` in the constructor. Final relevant parts:

Imports (drop `Stripe` and `env`; keep the rest):
```ts
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { BillingWebhookHandler } from './billing.webhook';
import { ActiveUserId } from '@shared/decorators/active-user-id.decorator';
import { isPublic } from '@shared/decorators/public.decorator';
import { SubscribeDto } from './dto/subscribe.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
```

Constructor (drop the field + `new Stripe()`):
```ts
  constructor(
    private readonly billingService: BillingService,
    private readonly billingWebhookHandler: BillingWebhookHandler,
  ) {}
```

`handleWebhook`:
```ts
  @Post('webhook')
  @isPublic()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleWebhook(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature)
      throw new UnauthorizedException('Missing stripe-signature header.');

    const event = this.billingWebhookHandler.constructEvent(
      (req as any).rawBody,
      signature,
    );

    await this.billingWebhookHandler.handle(event);
    return { received: true };
  }
```

- [ ] **Step 6: Typecheck, lint, and run the billing e2e signature tests**

```bash
npx tsc --noEmit
npm run lint
```

Expected: no type errors; lint clean (confirms no unused `Stripe`/`env` import left in the controller).

```bash
docker compose up -d
npx jest --config ./test/jest-e2e.json --coverage=false test/e2e/billing.e2e-spec.ts
```

Expected: PASS — the three signature tests (401 missing header, 401 invalid signature, 200 valid signature) still pass with verification now in the real handler.

- [ ] **Step 7: Commit**

```bash
git add src/shared/billing/billing.webhook.ts src/shared/billing/billing.webhook.spec.ts src/shared/billing/billing.controller.ts
git commit -m "refactor: move Stripe webhook signature verification into the handler, thin the controller"
```

---

### Task 4: Avatar `ext` validation

**Files:**
- Create: `src/modules/users/infra/http/dto/avatar-upload-url.dto.ts`
- Modify: `src/modules/users/infra/http/users.controller.ts`
- Modify: `test/e2e/users.e2e-spec.ts`

**Interfaces:**
- Produces: `AvatarUploadUrlDto` with an `ext: string` field constrained to the allowlist.

- [ ] **Step 1: Create the DTO**

Create `src/modules/users/infra/http/dto/avatar-upload-url.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class AvatarUploadUrlDto {
  @ApiProperty({ enum: ['jpg', 'jpeg', 'png', 'webp'] })
  @IsIn(['jpg', 'jpeg', 'png', 'webp'])
  ext: string;
}
```

- [ ] **Step 2: Add the failing e2e tests**

In `test/e2e/users.e2e-spec.ts`, the existing `describe('GET /users/me/avatar-upload-url', ...)` block has one test. Add two after it (inside the same describe):

```ts
    it('returns 400 for a non-allowlisted extension', async () => {
      const res = await request(app.getHttpServer())
        .get('/users/me/avatar-upload-url')
        .query({ ext: 'svg' })
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
    });

    it('returns 400 when ext is missing', async () => {
      const res = await request(app.getHttpServer())
        .get('/users/me/avatar-upload-url')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
    });
```

- [ ] **Step 3: Run to verify failure**

```bash
docker compose up -d
npx jest --config ./test/jest-e2e.json --coverage=false test/e2e/users.e2e-spec.ts
```

Expected: the two new tests FAIL — `ext` is currently unvalidated, so `svg` and missing return 200, not 400.

- [ ] **Step 4: Use the DTO in the controller**

In `src/modules/users/infra/http/users.controller.ts`, add the import:

```ts
import { AvatarUploadUrlDto } from './dto/avatar-upload-url.dto';
```

Change the `getAvatarUploadUrl` handler to bind the whole query to the DTO (drop the `@Query('ext')` single-param form). Keep the `@ApiOperation`/`@ApiResponse` decorators; add a 400 response doc:

```ts
  @Get('/me/avatar-upload-url')
  @ApiOperation({
    summary: '/me/avatar-upload-url',
    description: 'Get a presigned S3 URL to upload an avatar',
  })
  @ApiResponse({ status: 200, description: 'Returns uploadUrl and avatarUrl' })
  @ApiResponse({ status: 400, description: 'ext must be jpg, jpeg, png or webp' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  getAvatarUploadUrl(
    @ActiveUserId() userId: string,
    @Query() { ext }: AvatarUploadUrlDto,
  ) {
    return this.usersService.getAvatarUploadUrl(userId, ext);
  }
```

If `Query` is the only remaining use, keep its import — it's still used. (`@Query()` with no arg still needs the `Query` import from `@nestjs/common`.)

- [ ] **Step 5: Run to verify pass**

```bash
npx jest --config ./test/jest-e2e.json --coverage=false test/e2e/users.e2e-spec.ts
npx tsc --noEmit
```

Expected: all users e2e tests pass — `ext=jpg` → 200, `ext=svg` → 400, missing → 400. No type errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/users/infra/http/dto/avatar-upload-url.dto.ts src/modules/users/infra/http/users.controller.ts test/e2e/users.e2e-spec.ts
git commit -m "fix: validate avatar upload ext against an image allowlist (jpg/jpeg/png/webp)"
```

---

### Task 5: Full suite + README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.

- [ ] **Step 1: Run the whole suite**

```bash
docker compose up -d
npm test
```

Expected: exit 0. Note the combined coverage and the unit/e2e counts. Unit tests gained 2 in `billing.webhook.spec.ts` (constructEvent) — expect 155 → 157; e2e gained 2 in `users.e2e-spec.ts` — expect 67 → 69. Verify against the actual run.

- [ ] **Step 2: Update the counts in `README.md`**

In the Stack line (`- **Tests:** Jest 30 + Supertest — 155 unit + 67 e2e tests, ...`) and the Unit/E2E bullets in the `## Tests` section, update the counts to the numbers `npm test` actually reported in Step 1.

- [ ] **Step 3: Add a line about the avatar validation and Resend timeout**

In the `## Avatar Upload (AWS S3)` section, the first numbered step currently reads:

```
1. `GET /users/avatar-upload-url?ext=jpg` → returns `{ uploadUrl, avatarUrl }`
```

Replace with:

```
1. `GET /users/me/avatar-upload-url?ext=jpg` → returns `{ uploadUrl, avatarUrl }` (`ext` is validated against an image allowlist: jpg, jpeg, png, webp)
```

In the `## Email Flow (Resend)` section, append a line after the existing bullets:

```
- Every Resend call has a 10s request timeout, so a hung provider can't stall the mail-queue worker (a timed-out send fails and is retried by the queue).
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: note avatar ext allowlist + Resend timeout, refresh test counts"
```
