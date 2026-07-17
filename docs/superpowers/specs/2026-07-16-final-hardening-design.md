# Final Hardening — Design Spec

**Sub-project 4/4 of the error-handling audit, plus two deferred refactors.** Prior work: 1/4 global exception filter (#22), 2/4 email retry queue (#23/#24), 3/4 Stripe webhook idempotency (#25) — all merged. This bundles the remaining three small, independent hardening items into one PR.

## Part 1 — Resend request timeout

**Problem:** `MailService`'s four `this.resend.emails.send(payload)` calls (`src/shared/mail/mail.service.ts`) pass no timeout. Node's `fetch` (which the Resend SDK uses) has no default timeout, so a hung Resend request blocks the BullMQ worker job until its `lockDuration` (30s) expires — at which point the stalled-job checker can move the job back to `wait` and let it run again, potentially sending a **duplicate email**. This is exactly the failure class the mail queue was built to handle gracefully; the missing timeout undercuts it.

**Fix:** pass `{ signal: AbortSignal.timeout(RESEND_TIMEOUT_MS) }` as the second argument to every `emails.send()` call. `RESEND_TIMEOUT_MS = 10000` — comfortably above a healthy email API's latency, well below BullMQ's 30s `lockDuration`, so a hung call aborts before it can stall. A timed-out `send()` rejects → the worker job fails → BullMQ retries it via the existing `email-retry` backoff. No new dependency (`AbortSignal.timeout` is native since Node 17; project runs Node 20).

The Resend SDK's `emails.send(payload, options)` forwards `options.signal` to the underlying fetch, so this genuinely cancels the request, not just stops waiting on it.

## Part 2 — Single Stripe client + signature verification in the handler

**Problem:** `BillingController` and `BillingService` each construct their own `new Stripe(env.stripeSecretKey)`. The controller's instance is used only for `webhooks.constructEvent` (signature verification) inside `handleWebhook` — so signature-verification logic (and the raw `env.stripeWebhookSecret` handling) lives in the HTTP controller, which the audit flagged as a leak of billing concern into the transport layer.

**Fix (two coupled changes):**

1. **One shared Stripe instance via DI.** Add a provider to `BillingModule`:
   ```ts
   { provide: STRIPE_CLIENT, useFactory: () => new Stripe(env.stripeSecretKey) }
   ```
   `STRIPE_CLIENT` is an injection token (a `Symbol` or string const exported from a small `stripe.provider.ts` in `src/shared/billing/`). `BillingService` and `BillingWebhookHandler` inject it via `@Inject(STRIPE_CLIENT) private readonly stripe: Stripe` instead of `new Stripe(...)`. The project has no prior third-party-client-injection precedent; a token provider is the idiomatic NestJS way and keeps the single instance testable (override the token in unit tests).

2. **Move signature verification into `BillingWebhookHandler`.** New public method:
   ```ts
   constructEvent(rawBody: Buffer, signature: string): Stripe.Event
   ```
   It wraps `this.stripe.webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret)` and, on failure, throws `UnauthorizedException('Invalid webhook signature.')` (the exact message the controller throws today). `BillingController.handleWebhook` becomes thin:
   ```ts
   if (!signature) throw new UnauthorizedException('Missing stripe-signature header.');
   const event = this.billingWebhookHandler.constructEvent(req.rawBody, signature);
   await this.billingWebhookHandler.handle(event);
   return { received: true };
   ```
   The controller no longer imports `Stripe` or references `env.stripeWebhookSecret`. `handle(event)` stays exactly as-is (idempotency logic from #25 untouched).

**Out of scope:** the `env.stripeWebhookSecret` value stays where it is (env config); only where it's *consumed* moves from controller to handler.

## Part 3 — Avatar `ext` validation (audit finding 4/4)

**Problem:** `GET /users/me/avatar-upload-url` takes `@Query('ext') ext: string` (`src/modules/users/infra/http/users.controller.ts`) with no validation, and it flows straight into the S3 object key (`avatars/${userId}/${randomUUID()}.${ext}` in `StorageService.generateUploadUrl`). Without an allowlist, a client can request a presigned URL for an arbitrary extension — e.g. `.svg` (which can carry embedded JavaScript) or `.html` — creating a stored-XSS risk if avatars are ever served from a browsable domain and rendered. (Not exploitable in the current setup, but a real gap and a textbook interview topic.)

**Fix:** new DTO `AvatarUploadUrlDto` (`src/modules/users/infra/http/dto/avatar-upload-url.dto.ts`):
```ts
export class AvatarUploadUrlDto {
  @ApiProperty({ enum: ['jpg', 'jpeg', 'png', 'webp'] })
  @IsIn(['jpg', 'jpeg', 'png', 'webp'])
  ext: string;
}
```
The controller changes `@Query('ext') ext: string` → `@Query() { ext }: AvatarUploadUrlDto`. The global `ValidationPipe` (`whitelist: true, transform: true`, already configured in both `main.ts` and the e2e bootstrap) rejects a missing or non-allowlisted `ext` with **400** before any presigned URL is generated. `svg`/`html`/arbitrary are blocked.

## Testing

- **Unit `mail.service.spec.ts`**: each `send` assertion additionally checks the options arg carries an abort signal — `expect.objectContaining({ signal: expect.any(AbortSignal) })`. (The existing spec mocks the Resend client; extend those assertions.)
- **Unit `billing.webhook.spec.ts`**: Stripe is now injected via `STRIPE_CLIENT` token — provide a mock in the TestingModule. New tests for `constructEvent`: a mock whose `webhooks.constructEvent` returns an event → method returns it; a mock that throws → method throws `UnauthorizedException`. Existing `handle` tests are unaffected (constructor gains the Stripe token; supply the mock).
- **Unit `billing.controller.spec.ts`**: controller no longer instantiates Stripe; assert `handleWebhook` delegates to `handler.constructEvent` then `handler.handle` (mock the handler). If no controller spec exists, the e2e signature tests below are the coverage — do not invent one just to cover this.
- **Unit `avatar-upload-url.dto` / users.controller**: covered by the e2e below (DTO validation is integration behavior); the existing `users.service.spec.ts` for `getAvatarUploadUrl` is unaffected (service signature unchanged).
- **E2E `billing.e2e-spec.ts`**: the three existing signature tests (401 no header, 401 invalid signature, 200 valid signature) must still pass with verification now living in the real handler — they already run the real handler after #25, so this validates the move end-to-end.
- **E2E `users.e2e-spec.ts`**: `?ext=jpg` → 200 with `{ uploadUrl, avatarUrl }` (existing test, keep); add `?ext=svg` → 400 and no `ext` → 400.

## Scope / structure

Three independent parts, one hardening PR, atomic commits (roughly one per part plus its tests). No changes to the idempotency, retry-queue, or exception-filter behavior shipped in #22–#25.

## Explicitly out of scope

- Restricting the presigned PUT's `Content-Type` at the S3 level (belt-and-suspenders beyond the extension allowlist) — YAGNI for this project's scale; the allowlist closes the practical gap.
- Any CORS/origin tightening or Redis auth for production deploy — separate deployment-hardening concern, not part of this audit.
