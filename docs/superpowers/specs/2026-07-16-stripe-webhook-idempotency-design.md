# Stripe Webhook Idempotency — Design Spec

**Sub-project 3/4 of the error-handling audit.** Prior work: 1/4 global exception filter + structured logging (PR #22), 2/4 email retry queue (PR #23, hardened in #24).

## Problem

Stripe delivers webhook events at-least-once: timeouts, network failures, or a non-2xx response make it redeliver the same event (same `event.id`, `evt_...`) for up to ~3 days. `BillingWebhookHandler` (`src/shared/billing/billing.webhook.ts`) has no deduplication — every delivery is processed as if it were the first.

Observable effects of a duplicate delivery today:

- `customer.subscription.deleted` → `sendSubscriptionCancelled` email is sent **again, unconditionally** — guaranteed duplicate email.
- `invoice.payment_succeeded` / `customer.subscription.updated` → the plan update re-runs (same values, harmless), and the `isDowngrade` check self-heals only by accident (after the first processing `user.plan` already equals `newPlan`, so the comparison turns false). Fragile: any future handler logic that isn't naturally self-healing silently breaks.

A second, related gap: these billing emails call `MailService` (Resend) directly and synchronously. If Resend is down mid-handler, the whole handler throws → Stripe retries the event → the DB update re-runs. Today that retry is what re-attempts the email — but once deduplication exists, a naive implementation would skip the retry and **lose the email forever**. Idempotency and email delivery must be designed together.

## Decisions (made during brainstorming)

1. **Dedup store: Postgres table** (not Redis SET+TTL) — durable, no TTL management, and lives next to the data it guards.
2. **Billing emails move to the BullMQ mail queue** in this same sub-project — removes the lost-email window that dedup would otherwise create, and makes billing consistent with signup/email-change (sub-project 2/4).
3. **Retention: 30 days + daily cleanup cron** — comfortable margin over Stripe's ~3-day retry window, table never grows unbounded (same class of fix as the Redis job-retention cap in PR #24).

## Architecture

### New Prisma model

```prisma
model ProcessedStripeEvent {
  id          String   @id @default(uuid()) @db.Uuid
  eventId     String   @unique
  type        String
  processedAt DateTime @default(now())

  @@map("processed_stripe_events")
}
```

One migration. `eventId` holds Stripe's `event.id` (`evt_...`); the unique constraint is the concurrency guard.

### New repository

`StripeEventsRepository` — lives in `src/shared/billing/` (billing is a shared concern; the `shared/` convention is flat services, the full domain/application/infra split applies to feature modules only). Follows the project's abstract-class-as-DI-token pattern:

- `register(eventId: string, type: string): Promise<boolean>` — attempts the INSERT. Unique violation (Prisma P2002) → returns `false` (event already processed). Success → `true`. Any other error propagates.
- `unregister(eventId: string): Promise<void>` — deletes the row (compensation path).
- `deleteOlderThan(date: Date): Promise<void>` — used by the cleanup cron.

Prisma implementation bound in `BillingModule` via `{ provide: StripeEventsRepository, useClass: StripeEventsPrismaRepository }`.

### Handler flow (record-first + compensation)

```
handle(event):
  isNew = await stripeEventsRepository.register(event.id, event.type)
  if (!isNew) return                      // duplicate: 200 to Stripe, no reprocessing
  try {
    switch (event.type) { ... }           // DB plan updates + email enqueues
  } catch (err) {
    await stripeEventsRepository.unregister(event.id)  // compensation
    throw err                             // → 500 → Stripe retries → full reprocess
  }
```

Why record-first (instead of record-after-success): two concurrent deliveries of the same event race; with record-first, the second `register` hits the unique constraint and returns `false` — no double processing window. Record-after would leave that window open.

Why compensation (unregister on failure): a real processing failure (e.g. Postgres error during the plan update) must not "burn" the event — deleting the record lets Stripe's retry reprocess from scratch. Known accepted edge: if `unregister` itself fails, the event stays marked processed while the plan update didn't happen; the thrown error is still logged with the full stack by the global exception filter, making it diagnosable. At this project's scale that residual window is acceptable.

### Billing emails via the mail queue

`MailQueueService` gains two methods, mirroring the existing pattern exactly (same retry options: 60 attempts, `email-retry` backoff, retention caps):

- `queueDowngradeNotification(to: string, name: string, newPlan: string): Promise<void>`
- `queueSubscriptionCancelled(to: string, name: string): Promise<void>`

Two new job names in `mail-job.types.ts` (`downgrade-notification`, `subscription-cancelled`) with their data interfaces; `MailProcessor.process()` gains the two corresponding branches calling the existing, unchanged `MailService` methods.

`BillingWebhookHandler` switches from `MailService` to `MailQueueService`. After this, the only ways `handle()` can throw are DB failures — enqueueing is best-effort and never throws (established behavior from sub-project 2/4). Accepted trade-off (same as signup): Redis down at enqueue time → email lost with an error log, plan update still correct.

### Cleanup cron

`StripeEventsCleanupJob` in `src/shared/billing/` — `@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)`, calls `stripeEventsRepository.deleteOlderThan(now - 30 days)`. Same shape as the existing `refresh-tokens-cleanup.job.ts`.

## Failure matrix

| Scenario | Behavior |
|---|---|
| Duplicate delivery (sequential or concurrent) | Second `register` returns `false` → handler returns immediately → 200 to Stripe. One plan update, one email job, ever. |
| DB failure during plan update | `unregister` compensation runs → error propagates → 500 → Stripe retries → full reprocess. |
| Redis down when enqueueing the email | Caught/logged inside `MailQueueService` (existing behavior) → handler still succeeds → event stays registered. Email lost (logged). |
| Resend down when the worker processes the job | BullMQ retries per `email-retry` backoff for ~24h — webhook already answered 200, unaffected. |
| `unregister` itself fails after a processing failure | Unregister failure is caught and logged separately; the ORIGINAL processing error still propagates to the global filter (stack + errorId). Event stays marked processed while the plan update didn't happen — accepted residual risk. |
| Unhandled event type | Registered then no-op (switch falls through) — duplicate deliveries of ignored types are also deduped. Harmless. |

## Testing

- **Unit — `StripeEventsPrismaRepository`**: `register` returns `true` on first insert, `false` on P2002, rethrows other errors; `unregister` deletes; `deleteOlderThan` filters by date (mock PrismaService).
- **Unit — `BillingWebhookHandler`**: duplicate (`register` → `false`) → no repository update, no enqueue; processing failure → `unregister` called with the event id and the error rethrown; happy paths now assert `MailQueueService.queueX` instead of `MailService.sendX`.
- **Unit — `MailQueueService`/`MailProcessor`**: the two new job types follow the existing spec patterns (enqueue options assertion; processor dispatch assertion).
- **E2E — duplicate delivery**: POST the same signed webhook event twice (existing `stripe.webhooks.generateTestHeaderString` helper); assert both return 200, the plan update applied once, and exactly one mail job was processed (`mockMailService.sendSubscriptionCancelled` called once).
- **E2E — retry after failure**: harder to force a mid-handler DB failure through HTTP; covered at unit level instead (compensation path). E2E asserts the dedup row exists in `processed_stripe_events` after a delivery.

Note: e2e currently mocks `BillingWebhookHandler` entirely (`mockBillingWebhookHandler` in `test/helpers/create-app.ts`) — the billing e2e spec only verifies signature checking. The duplicate-delivery e2e needs the REAL handler with only `MailService` mocked (consistent with the project's mock-only-the-external-boundary philosophy). The design: stop overriding `BillingWebhookHandler` in `createApp`, keep mocking `MailService`/`BillingService`. `BillingService` (Stripe API calls) stays mocked; the webhook handler makes no Stripe API calls — it only reads the event payload, hits Postgres, and enqueues mail — so it can run for real.

## Out of scope

- Avatar `ext` validation and other minor gaps — sub-project 4/4.
- `new Stripe()` duplication between `BillingController`/`BillingService`, Resend fetch timeout — separately flagged refactors, deferred by explicit decision.
- Generic idempotency middleware for arbitrary endpoints — YAGNI; the webhook is the only at-least-once consumer.
