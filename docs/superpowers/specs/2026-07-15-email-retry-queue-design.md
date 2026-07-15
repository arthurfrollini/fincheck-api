# Email Retry Queue — Design Spec

**Sub-project 2/4 of the error-handling audit.** Prior work: sub-project 1/4 (global exception filter + structured logging via nestjs-pino) shipped in PR #22.

## Problem

`AuthService.signup` and `UsersService.requestEmailChange` each commit a database write and then call `MailService` (Resend) synchronously, with no error handling around the mail call:

- `signup` (`src/modules/auth/application/auth.service.ts:85-93`): creates the user row, then `await this.mailService.sendWelcome(...)`.
- `requestEmailChange` (`src/modules/users/application/users.service.ts:109-119`): writes `pendingEmail`/`emailToken`/`emailTokenExpiresAt`, then `await this.mailService.sendEmailChangeConfirmation(...)`.

If the Resend call throws (timeout, rate limit, outage, bad API key), the exception propagates uncaught, the global exception filter returns a 500, and the client sees a failure — but the DB write already committed. Retrying `signup` then fails with 409 (email already in use), which is confusing given the client was told the first attempt failed. `requestEmailChange` leaves an unreachable `pendingEmail` in the DB with no way for the user to know a retry is needed.

Frontend behavior (Next.js) treats user creation as the success signal: on signup, it shows a toast and immediately routes to authenticated app pages. Email delivery is not something the user waits on or currently sees feedback about. This means the desired behavior is: **the API response should depend only on the DB write succeeding — email delivery is best-effort and must never block or fail the request.**

For `requestEmailChange`, the same principle applies: the response reflects that the request was recorded, not that the email was delivered. Since the email link is the only way to complete the change, delivery must be retried aggressively until it succeeds or a long window elapses — the frontend can display something like "pending email change" state to reflect this.

## Scope

Only `signup` (welcome email) and `requestEmailChange` (confirmation email) move to the queue. `sendDowngradeNotification` and `sendSubscriptionCancelled` (sent from the Stripe billing webhook handler) are explicitly out of scope — the audit's finding there is about duplicate webhook delivery re-sending the same email (sub-project 3/4, idempotency), a different problem from delivery failure.

## Architecture

**New infrastructure:** Redis, added to `docker-compose.yml`:
- `redis` service (`redis:7-alpine`, port `6379`) — the actual queue backing store.
- `redisinsight` service (`redis/redisinsight`, port `5540`) — GUI for inspecting queue state during development, same role Beekeeper Studio plays for Postgres in this project. Chosen over a standalone desktop app so it comes up with `docker compose up` like the rest of the project's dev dependencies.

**New env vars** (`src/shared/config/env.ts`): `redisHost`, `redisPort`, following the existing flat-field convention (not a single `REDIS_URL`, to match how AWS/Stripe config is already broken into discrete fields).

**Queue wiring lives in `MailModule`** (not a new generic queue module) — only mail needs a queue right now, and introducing a project-wide queue abstraction ahead of a second use case would be speculative. `MailModule` gains:
- `BullModule.forRootAsync(...)` — connection config sourced from `env.redisHost`/`env.redisPort`.
- `BullModule.registerQueue({ name: 'mail' })`.

**`MailQueueService`** (new, `src/shared/mail/mail-queue.service.ts`) is what callers use instead of talking to `MailService` directly:
- `queueWelcome(to: string, name: string): Promise<void>`
- `queueEmailChangeConfirmation(to: string, token: string): Promise<void>`

Each method wraps `queue.add(...)` in try/catch. On failure (e.g. Redis unreachable), it logs via the structured logger (`PinoLogger`, same pattern as `AllExceptionsFilter`) and returns normally — it never throws. This is what makes the DB-write-then-email sequence resilient: nothing past the DB write can fail the request.

`AuthService.signup` and `UsersService.requestEmailChange` change their call site from `this.mailService.sendX(...)` to `this.mailQueueService.queueX(...)`.

**`MailProcessor`** (new, `src/shared/mail/mail.processor.ts`), `@Processor('mail')`, consumes queued jobs and calls the existing `MailService.sendWelcome` / `MailService.sendEmailChangeConfirmation` — these keep doing the real Resend call, unchanged. Unlike `MailQueueService`, the processor does **not** catch errors from `MailService` — letting them propagate is what tells BullMQ to schedule a retry per the job's backoff config.

`MailService` itself is unchanged — it remains the layer that actually talks to Resend, and stays the only thing e2e tests mock (see Testing below).

## Retry behavior

Custom backoff strategy (name: `email-retry`): delay doubles starting at 1s, capped at 30 minutes once reached, for up to ~60 attempts — this covers roughly 24 hours of sustained Resend outage while still retrying fast (within the first ~34 minutes) for a short blip.

Delay sequence (seconds): `1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024`, then flat `1800` (30 min) per attempt after that.

After the final attempt fails, the job is left in BullMQ's `failed` state — visible and manually inspectable/retriable via RedisInsight. No further automatic retry beyond the ~60 attempts (dead-letter, manual intervention).

## Failure matrix

| Failure point | Behavior |
|---|---|
| DB write fails (user create / pendingEmail update) | Unchanged — real error, request fails normally (e.g. via existing `ConflictException`/Prisma mapping). |
| `queue.add()` fails (Redis unreachable) | Caught in `MailQueueService`, logged, request still succeeds. |
| `MailService.sendX()` fails inside the processor (Resend unreachable/erroring) | Not caught — BullMQ schedules retry per `email-retry` backoff. Request already succeeded (queueing happened before this point). |
| Validation errors (e.g. invalid email format, missing payment method for paid plan) | Unchanged — still synchronous, still fails the request immediately. Nothing here is "external call resilience," it's regular input validation. |

## Testing

E2e tests keep mocking only `MailService` (same as today — plus the existing `StorageService`/`BillingService`/`BillingWebhookHandler` mocks), consistent with this project's existing e2e philosophy of mocking only the true external-service boundary. Redis and the BullMQ queue/worker run for real against the `redis` container from `docker-compose.yml`, so tests exercise the actual enqueue → process → (mocked) send path, not a stubbed queue. Tests that assert email was "sent" wait for job completion (e.g. via BullMQ's `QueueEvents`/`job.waitUntilFinished`) rather than asserting immediately after the HTTP response, since processing is asynchronous relative to the request.

Unit tests cover `MailQueueService` (mocking the BullMQ `Queue`, asserting `add` is called with the right job name/payload, and that a thrown error from `queue.add` is caught and logged without re-throwing) and `MailProcessor` (mocking `MailService`, asserting the right method is called per job name, and that a thrown error from `MailService` is *not* caught by the processor).

## Out of scope (explicitly deferred)

- Billing notification emails (`sendDowngradeNotification`, `sendSubscriptionCancelled`) — different problem (webhook idempotency), sub-project 3/4.
- Any UI/frontend work (e.g. a "pending email change" indicator) — backend-only spec; the frontend implication is noted for context but not built here.
- A general-purpose queue module for future non-mail use cases — YAGNI until a second use case exists.
