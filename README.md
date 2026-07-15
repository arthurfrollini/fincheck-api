# Fincheck API

REST API for a personal finance management app. Users track bank accounts and transactions, organized by category, with plan-based feature limits enforced via Stripe subscriptions.

## Stack

- **Runtime:** Node.js + NestJS v11 (TypeScript)
- **Database:** PostgreSQL via Prisma v6 (Docker)
- **Auth:** JWT access token + UUID refresh token + Google OAuth 2.0
- **Email:** Resend (welcome, email change confirmation, billing notifications)
- **Storage:** AWS S3 (avatar upload via presigned URL)
- **Billing:** Stripe (subscriptions, webhooks, dunning)
- **Tests:** Jest 30 + Supertest — 117 unit + 61 e2e tests, 97%+ combined coverage

## Architecture

The codebase follows Clean Architecture principles with a clear separation between layers:

- **Domain** (`domain/`) — entities, repository interfaces, no framework dependencies
- **Application** (`application/`) — services containing business logic, depend only on domain abstractions
- **Infrastructure** (`infra/`) — Prisma repository implementations, HTTP controllers, DTOs, NestJS decorators

Each module is self-contained and depends on abstractions, not concrete implementations. Repositories are defined as abstract classes in the domain layer and injected via NestJS DI — swapping the database requires only a new `infra/database` implementation.

Shared concerns (auth guards, plan enforcement, mail, storage, billing) live in `src/shared/` and are exposed as NestJS modules, keeping feature modules focused on their own business rules.

## Modules

| Module | Description |
|--------|-------------|
| `auth` | Sign up, sign in, refresh token, sign out, Google OAuth |
| `users` | Profile, avatar upload, email change flow, admin CRUD |
| `bank-accounts` | CRUD + current balance computed from transactions |
| `categories` | CRUD — gated by plan (GOLD/PLATINUM only) |
| `transactions` | CRUD with daily limit enforcement per plan |
| `billing` | Stripe subscriptions — setup, subscribe, change plan, cancel, webhook |

## Plans

| | FREE | GOLD | PLATINUM |
|---|---|---|---|
| Bank accounts | 3 | 5 | unlimited |
| Transactions/day | 50 | 200 | unlimited |
| Categories (CRUD) | read-only | full | full |
| Price | free | R$35/mo | R$65/mo |

## Auth Flow

1. **Sign up / Sign in** → returns `accessToken` (JWT, short-lived) + `refreshToken` (UUID, 7 days)
2. **Access token expires** → `POST /auth/refresh` with `refreshToken` → new pair issued, old token deleted
3. **Sign out** → `POST /auth/signout` deletes the refresh token
4. **Google OAuth** → `GET /auth/google` → callback links or creates account

## Email Flow (Resend)

- Welcome email on signup
- Email change confirmation — user receives a token link, `GET /users/confirm-email/:token` applies the change
- Billing: downgrade notification, subscription cancellation on payment failure

## Avatar Upload (AWS S3)

1. `GET /users/avatar-upload-url?ext=jpg` → returns `{ uploadUrl, avatarUrl }`
2. Frontend uploads directly to S3 via the presigned URL
3. Frontend calls `PATCH /users/me` with `{ avatarUrl }` to save

## Billing Flow (Stripe)

1. `POST /billing/setup` → creates Stripe Customer + SetupIntent, returns `clientSecret` for Stripe Elements
2. User completes card setup on frontend
3. `POST /billing/subscribe` with `{ planId: 'GOLD' | 'PLATINUM' }` → creates subscription
4. Stripe fires `invoice.payment_succeeded` → webhook updates `user.plan` in DB
5. `POST /billing/change-plan` → upgrades invoice immediately (`always_invoice`), downgrades at period end (`none`)
6. `POST /billing/cancel` → `cancel_at_period_end: true`, user keeps plan until billing period ends
7. `customer.subscription.deleted` (dunning failure / period end) → resets `user.plan` to FREE

Webhook endpoint: `POST /billing/webhook` — validates Stripe signature via `rawBody`.

## Local Setup

```bash
# 1. Start PostgreSQL
docker compose up -d

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env  # fill in values

# 4. Run migrations
npx prisma migrate dev

# 5. Start dev server
npm run start:dev
```

## Environment Variables

```env
DATABASE_URL=
JWT_SECRET=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_BUCKET_NAME=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_GOLD=
STRIPE_PRICE_PLATINUM=
```

## Tests

Two independent suites, kept deliberately separate — each covers a different architectural layer, so either report in isolation is misleading. "Coverage" only means something combined.

- **Unit** (`test:unit`) — Jest, testing the `application`/`domain` layer in isolation. Dependencies mocked with Jest's own `jest.fn()`/`jest.mock()` — no Sinon, no ts-mockito, no separate mocking library. 117 tests.
- **E2E** (`test:e2e`) — Jest + Supertest, booting the real `AppModule` against a dedicated `fincheck_test` Postgres database (`PrismaService` is never mocked). Only `MailService`, `StorageService`, `BillingService`, and the Stripe webhook handler are replaced with mocks — everything else runs for real, including the BullMQ email retry queue (real Redis, real worker, only the final Resend call is mocked) and Stripe webhook signature verification (via `stripe.webhooks.generateTestHeaderString`, pure local HMAC, no network call). 65 tests across 7 spec files: auth, users, admin routes, bank-accounts, categories, transactions, billing.
- No browser/UI E2E — no Playwright, no Cypress. This is an API-only project; the HTTP layer is tested directly with Supertest, no browser needed.

```bash
npm run test:unit     # unit only, ~2s
npm run test:e2e      # e2e only, real DB, ~50s
npm test              # both, merged coverage report — the number that matters
```

`npm test` runs both suites and merges their coverage via `nyc`, since neither suite's own report reflects real coverage alone — unit only touches `application`/`domain`, e2e only touches `infra`/`http` (plus whatever it deliberately mocks). Combined: **97%+ statements**.

E2E requires Docker running (`docker compose up -d`, which provisions the `fincheck`/`fincheck_test` Postgres databases plus Redis and RedisInsight for the email retry queue) and a local `.env.test` file (same shape as `.env`, fake credentials for Resend/AWS/Stripe/Google — gitignored, never used for a real network call).

Note: running `npm run test:e2e` standalone can occasionally exit non-zero from a known, tracked BullMQ/Redis teardown race that occurs *after* all tests pass (see `.superpowers/sdd/task-5-report.md`). `npm test` is unaffected — it determines pass/fail from Jest's own result summary instead of the raw exit code, so it's the command that gates `npm run lint`/pre-push/CI.

## Git Hooks (Husky)

- **pre-push:** `eslint + tsc --noEmit + prettier --check (src/ and test/) + npm test` — blocks push on any failure
