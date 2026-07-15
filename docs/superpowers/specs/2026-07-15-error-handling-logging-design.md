# Global Error Handling + Structured Logging — Design

**Status:** Approved by user, ready for implementation planning.

## Goal

Close the highest-leverage gap from the error-handling audit (see project memory / the
2026-07-14 audit conversation): there is no global exception filter today, so every
unexpected failure — a Prisma constraint violation, a Stripe API error, any uncaught
bug — collapses into an opaque `500 { "message": "Internal server error" }` with zero
internal logging. This is the first of 4 sub-projects addressing that audit; the other
3 (external-call resilience around signup/email-change, Stripe webhook idempotency,
minor validation gaps) are separate, later specs.

## Why now

- Highest-leverage single change identified in the audit: one filter fixes the Prisma
  translation gap, the Stripe translation gap, AND establishes the logging
  infrastructure the other 3 sub-projects (and all future work) will build on.
- Zero logging exists today (confirmed via `grep` across `src/` for `Logger`,
  `console.`, `Sentry` — no hits). Any production issue is currently invisible beyond
  raw HTTP status codes.
- Resolves audit finding #5's status-code half (`createByAdmin` returning a raw 500 on
  duplicate email instead of 409) as a side effect — see "Scope reduction" below.

## Architecture

- **`nestjs-pino`** for structured JSON logging. Replaces the (currently unused)
  default NestJS logger app-wide. `pino-http` (nestjs-pino's underlying HTTP
  middleware) generates a `req.id` (correlation id) automatically per request — no
  custom middleware needed for that part.
- **One global exception filter**, `@Catch()` with no arguments (catches every thrown
  value, not just `HttpException` subclasses), registered via `APP_FILTER` in
  `app.module.ts` alongside the existing `AuthGuard`/`RolesGuard` providers.
- **Two pure mapper functions**, each `(error: unknown) => HttpException | null` —
  return the translated exception if the input matches a known error shape, `null`
  otherwise (so the filter can chain: try Prisma mapper, then Stripe mapper, then fall
  back to generic handling):
  - `mapPrismaError`: `PrismaClientKnownRequestError` with code `P2002` →
    `ConflictException`; `P2025` → `NotFoundException`; `P2003` → `BadRequestException`.
    Any other Prisma error code → `null` (falls through to generic 500 handling, still
    logged with stack trace — an unmapped Prisma code is exactly the kind of thing
    that should be visible, not silently swallowed into a wrong status).
  - `mapStripeError`: `Stripe.errors.StripeCardError` → `BadRequestException` using
    Stripe's own `error.message` (Stripe designs `StripeCardError` messages to already
    be safe to show end users — e.g. "Your card was declined"). Any other
    `Stripe.errors.StripeError` subclass (`StripeAPIError`, `StripeConnectionError`,
    `StripeAuthenticationError`, `StripeInvalidRequestError`, etc.) → `BadGatewayException`
    with a generic `'Payment provider error.'` message — these represent either Stripe's
    own outage or our own misconfiguration, neither safe nor useful to detail to the
    client. Non-Stripe errors → `null`.

## Log level policy

- **Final status ≥ 500** (includes anything neither mapper recognized): log at `error`
  level with the **full stack trace** (`error.stack`) and a generated `errorId` (short
  uuid, e.g. `crypto.randomUUID().slice(0, 8)`). This is real developer-debugging
  signal — an actual bug or an unexpected external failure, not a normal outcome.
- **Final status < 500**: log a compact line at `warn` (401/403 — auth/authorization
  outcomes worth a lower-severity trace) or `info` (400/404/409 — ordinary
  validation/business-rule outcomes) — message + status only, no stack trace. These
  are the application working correctly, not bugs; a full stack trace here is noise
  that would drown out the 500s that actually matter.

## Error response shape

- **Status ≥ 500**: `{ "statusCode": 500, "message": "Internal server error", "errorId": "a1b2c3d4" }`
  — the `errorId` is the same value used in the internal log line for that error, so a
  user/support report ("I got errorId a1b2c3d4") can be grepped straight to the exact
  log entry, full stack trace included, without needing to correlate by timestamp.
- **Status < 500**: unchanged from today — NestJS's existing `{ statusCode, message,
  error }` shape via each translated (or original) `HttpException`. No `errorId` here;
  these are already well-formed, actionable-by-the-client messages (validation array,
  "Category not found.", etc.) — no client action to "report an errorId" makes sense
  for its own bad request.

## Scope reduction: audit finding #5

The audit flagged `UsersService.createByAdmin` as missing an email-uniqueness
pre-check, meaning a duplicate-email admin-create hits the DB's unique constraint and
surfaces a raw `PrismaClientKnownRequestError` → generic 500 instead of a clean 409.
Once `mapPrismaError` translates `P2002` → `ConflictException` globally, this specific
symptom (wrong status code) is fixed automatically, with no per-endpoint pre-check
needed. Sub-project 4 (minor validation gaps) now only needs to cover the unvalidated
avatar `ext` query parameter — confirm this during that sub-project's own brainstorm
rather than assuming it's fully closed; a live e2e test in this sub-project's plan
will prove the new status code, not just reasoning about it.

## File structure

- `src/shared/filters/all-exceptions.filter.ts` — the `@Catch()` global filter class
- `src/shared/filters/prisma-error.mapper.ts` — `mapPrismaError`, pure function
- `src/shared/filters/stripe-error.mapper.ts` — `mapStripeError`, pure function
- `src/main.ts` — wire up `nestjs-pino`'s logger (`app.useLogger(app.get(Logger))`
  pattern, `bufferLogs: true` on `NestFactory.create` so nothing logged during
  bootstrap before the pino logger is attached gets lost)
- `src/app.module.ts` — `LoggerModule.forRoot(...)` (nestjs-pino) import, plus
  `{ provide: APP_FILTER, useClass: AllExceptionsFilter }`
- `test/helpers/create-app.ts` — same `LoggerModule`/filter wiring needed here too
  (this file builds its own app independently of `main.ts`, same duplication pattern
  already established for the Swagger/Scalar bootstrap in the previous sub-project —
  keep both in sync)

## Testing

- **Unit tests** for both mapper functions — table of Prisma error codes / Stripe
  error subclasses → expected `HttpException` type + status + message, plus the
  "unrecognized input → returns `null`" case for each.
- **Unit test for the filter class itself** — instantiate directly, call `catch()`
  with a mock `ArgumentsHost` and a generic unmapped `Error`, assert: response status
  500, response body has `errorId` matching a uuid-ish shape, logger was called with
  `error` level and the original error's stack trace present in the logged payload.
  Also assert the 4xx path: an existing `HttpException` (e.g. `NotFoundException`)
  passes through with its own status/message, response has no `errorId`, logger called
  at `warn`/`info` not `error`.
- **One live e2e test** closing the loop on audit finding #5: admin creates a user via
  `POST /users`, then creates a second user with the same email — asserts the second
  request returns `409` (not `500`), proving the global filter's Prisma translation
  actually works end-to-end against the real database, not just against a mocked
  error object in a unit test.

## Out of scope (explicitly, to prevent scope creep during implementation)

- **External-call resilience** (Resend/Stripe failures after a DB write already
  committed, e.g. in `signup`/`requestEmailChange`) — audit finding #2, separate
  sub-project.
- **Stripe webhook idempotency** (duplicate event delivery re-sending notification
  emails) — audit finding #3, separate sub-project.
- **Avatar `ext` query param validation** — the remaining half of audit finding #5
  after this sub-project's scope reduction above — separate sub-project (4).
- **No third-party observability platform integration** (Datadog, Grafana, Sentry,
  etc.) — this sub-project only makes the application itself emit structured JSON
  logs to stdout. Routing those logs to an external platform is an infrastructure
  decision outside this codebase, not part of this spec.
- **No change to any already-correct 4xx status/message** an existing service already
  throws explicitly (`NotFoundException('Bank account not found.')` etc.) — the filter
  passes pre-existing `HttpException` instances through unchanged; only genuinely
  unhandled/untranslated errors are affected.
