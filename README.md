# Fincheck API

REST API for a personal finance management app. Users track bank accounts and transactions, organized by category, with plan-based feature limits enforced via Stripe subscriptions.

## Stack

- **Runtime:** Node.js + NestJS v11 (TypeScript)
- **Database:** PostgreSQL via Prisma v6 (Docker)
- **Auth:** JWT access token + UUID refresh token + Google OAuth 2.0
- **Email:** Resend (welcome, email change confirmation, billing notifications)
- **Storage:** AWS S3 (avatar upload via presigned URL)
- **Billing:** Stripe (subscriptions, webhooks, dunning)
- **Tests:** Jest 30 (72 unit tests, all services mocked)

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

```bash
npm test                   # run all 72 unit tests
npm test -- --verbose      # with test names
```

## Git Hooks (Husky)

- **pre-commit:** `prettier --write` auto-formats staged files
- **pre-push:** `eslint + tsc --noEmit + prettier --check + npm test` — blocks push on any failure
