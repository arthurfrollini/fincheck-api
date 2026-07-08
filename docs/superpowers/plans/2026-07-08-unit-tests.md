# Unit Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Write unit tests (with mocks) for all services with real business logic; delete unnecessary stub spec files.

**Architecture:** Each service is tested in isolation with all dependencies mocked via jest.fn(). No real DB, no Stripe API calls, no mail sends.

**Tech Stack:** NestJS v11, Jest 30, ts-jest, bcryptjs, Stripe SDK v22

## Global Constraints

- All tests use `jest.fn()` mocks — no real DB, HTTP, or Stripe calls
- Run tests with: `npm test` (from project root `/Users/Arthur/Desktop/VS/Node/fincheck/api`)
- All new/modified test files must pass `npm run lint` and `npx tsc --noEmit`
- Working directory: `/Users/Arthur/Desktop/VS/Node/fincheck/api`
- Module aliases: `@modules/` → `src/modules/`, `@shared/` → `src/shared/`
- NestJS Testing: use `Test.createTestingModule({ providers: [...] }).compile()`
- Do NOT use `@nestjs/testing`'s `overrideProvider` — use direct `useValue` mocks in providers array
- Commit message format: `test(<scope>): <description>`

---

### Task 1: Cleanup — delete unnecessary stub files

**Files to DELETE:**
- `src/modules/auth/infra/http/auth.controller.spec.ts`
- `src/modules/bank-accounts/infra/http/bank-accounts.controller.spec.ts`
- `src/modules/transactions/infra/http/transactions.controller.spec.ts`
- `src/modules/users/infra/http/users.controller.spec.ts`
- `test/app.e2e-spec.ts`

**Reason:** Controllers are thin wrappers with no business logic. The e2e spec tests a `GET /` route that doesn't exist. These stubs create noise and false negatives.

- [ ] Delete all 5 files listed above
- [ ] Run `npm test` — should still pass (only real tests: transactions.service, plan-guard.service, storage.service)
- [ ] Commit: `chore(tests): remove stub specs for controllers and e2e`

---

### Task 2: AuthService unit tests

**File:** `src/modules/auth/application/auth.service.spec.ts` (replace stub)

**Dependencies to mock:**
- `UsersRepository` — `findByEmail`, `findByGoogleId`, `findById`, `create`, `update`
- `RefreshTokensRepository` — `findByToken`, `create`, `deleteByToken`
- `JwtService` — `signAsync`
- `MailService` — `sendWelcome`
- `BillingService` — `createCustomerAndSubscribe`

**Test cases:**

`signin`:
- throws `UnauthorizedException` when user not found
- throws `UnauthorizedException` when user has no password (Google-only account)
- throws `UnauthorizedException` when password is wrong
- returns `{ accessToken, refreshToken }` on valid credentials

`signup`:
- throws `BadRequestException` when plan is GOLD and no paymentMethodId
- throws `ConflictException` when email already taken
- creates user, sends welcome email, returns tokens on FREE plan
- calls `billingService.createCustomerAndSubscribe` when plan is GOLD with paymentMethodId

`refresh`:
- throws `UnauthorizedException` when token not found
- throws `UnauthorizedException` when token is expired (deletes token)
- returns new tokens on valid refresh token

`signout`:
- calls `refreshTokensRepository.deleteByToken` with the token

`googleAuth`:
- returns tokens for existing Google user
- links Google ID to existing email user
- creates new user when neither Google ID nor email exist

- [ ] Write all test cases above (mock bcrypt hash/compare inline)
- [ ] Run `npm test -- --testPathPattern auth.service` — all pass
- [ ] Run `npm run lint` — no errors
- [ ] Commit: `test(auth): add unit tests for AuthService`

**Note on bcrypt:** mock `bcryptjs` at module level:
```ts
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  compare: jest.fn(),
}));
import { compare } from 'bcryptjs';
```

**Note on uuid:** mock `uuid` at module level:
```ts
jest.mock('uuid', () => ({ v4: jest.fn().mockReturnValue('test-uuid') }));
```

---

### Task 3: UsersService unit tests

**File:** `src/modules/users/application/users.service.spec.ts` (replace stub)

**Dependencies to mock:**
- `UsersRepository` — `findById`, `findByEmail`, `findByEmailToken`, `update`
- `MailService` — `sendEmailChangeConfirmation`
- `StorageService` — `generateUploadUrl`

**Test cases:**

`getUserById`:
- returns null when user not found
- returns `{ name, email, role, plan, avatarUrl }` (no password in response)

`updateMe`:
- throws `NotFoundException` when user not found
- returns updated user fields on success

`requestEmailChange`:
- throws `ConflictException` when new email already in use
- calls `usersRepository.update` with token + pendingEmail
- calls `mailService.sendEmailChangeConfirmation` with the token

`confirmEmailChange`:
- throws `BadRequestException` when token not found
- throws `BadRequestException` when token expired
- updates user email and clears pendingEmail/token fields on valid token

- [ ] Write all test cases above
- [ ] Run `npm test -- --testPathPattern users.service` — all pass
- [ ] Run `npm run lint` — no errors
- [ ] Commit: `test(users): add unit tests for UsersService`

---

### Task 4: BankAccountsService unit tests

**File:** `src/modules/bank-accounts/application/bank-accounts.service.spec.ts` (replace stub)

**Dependencies to mock:**
- `BankAccountsRepository` — `create`, `findManyWithTransactions`, `update`, `delete`
- `ValidateBankAccountOwnershipService` — `validate`
- `PlanGuardService` — `validateBankAccountLimit`, `getActiveAccountIds`

**Test cases:**

`create`:
- calls `planGuardService.validateBankAccountLimit` then `bankAccountsRepository.create`
- propagates ForbiddenException from planGuard when limit reached

`findAllByUserId`:
- computes `currentBalance = initialBalance + INCOME - EXPENSE` for each account
- sets `isActive: true` for accounts in `activeIds` set
- sets `isActive: true` for all accounts when `isUnlimited: true`
- sets `isActive: false` for accounts NOT in `activeIds` when not unlimited

`update`:
- calls `validateBankAccountOwnershipService.validate` then `bankAccountsRepository.update`

`remove`:
- calls `validateBankAccountOwnershipService.validate` then `bankAccountsRepository.delete`

- [ ] Write all test cases above
- [ ] Run `npm test -- --testPathPattern bank-accounts.service` — all pass
- [ ] Run `npm run lint` — no errors
- [ ] Commit: `test(bank-accounts): add unit tests for BankAccountsService`

---

### Task 5: BillingService unit tests

**File:** `src/shared/billing/billing.service.spec.ts` (NEW file)

**How to mock Stripe SDK:**
```ts
const mockStripe = {
  customers: { create: jest.fn(), retrieve: jest.fn(), update: jest.fn() },
  setupIntents: { create: jest.fn() },
  subscriptions: { create: jest.fn(), list: jest.fn(), update: jest.fn() },
  paymentMethods: { attach: jest.fn() },
};
jest.mock('stripe', () => jest.fn().mockImplementation(() => mockStripe));
```

Mock env:
```ts
jest.mock('@shared/config/env', () => ({
  env: {
    stripeSecretKey: 'sk_test_fake',
    stripePriceGold: 'price_gold',
    stripePricePlatinum: 'price_platinum',
  },
}));
```

**Dependencies to mock:**
- `UsersRepository` — `findById`, `update`
- Stripe SDK (module-level mock above)

**Test cases:**

`createSetupIntent`:
- creates new Stripe customer when user has no stripeCustomerId, saves it, returns clientSecret
- uses existing stripeCustomerId when present, returns clientSecret

`createSubscription`:
- throws `BadRequestException` when user has no stripeCustomerId
- throws `BadRequestException` when Stripe customer is deleted (`customer.deleted === true`)
- throws `BadRequestException` when customer has no default payment method
- creates subscription with GOLD priceId and saves stripePriceId

`changePlan`:
- throws `BadRequestException` when user has no stripeCustomerId
- sets `cancel_at_period_end: true` when newPlanId is FREE
- updates subscription with proration `always_invoice` for GOLD→PLATINUM upgrade
- updates subscription with proration `none` for PLATINUM→GOLD downgrade

`cancelSubscription`:
- throws `BadRequestException` when user has no stripeCustomerId
- calls `subscriptions.update` with `cancel_at_period_end: true`

`createCustomerAndSubscribe`:
- attaches payment method, sets as default, creates subscription, saves stripePriceId

- [ ] Write all test cases above
- [ ] Run `npm test -- --testPathPattern billing.service` — all pass
- [ ] Run `npm run lint` — no errors
- [ ] Commit: `test(billing): add unit tests for BillingService`

---

### Task 6: BillingWebhookHandler unit tests

**File:** `src/shared/billing/billing.webhook.spec.ts` (NEW file)

Mock env:
```ts
jest.mock('@shared/config/env', () => ({
  env: {
    stripePriceGold: 'price_gold',
    stripePricePlatinum: 'price_platinum',
  },
}));
```

**Dependencies to mock:**
- `UsersRepository` — `findByStripeCustomerId`, `update`
- `MailService` — `sendDowngradeNotification`, `sendSubscriptionCancelled`

**Helper to build Stripe events:**
```ts
const makeEvent = (type: string, object: Record<string, unknown>): Stripe.Event =>
  ({ type, data: { object } }) as unknown as Stripe.Event;
```

**Test cases:**

`handle — invoice.payment_succeeded`:
- returns early when user not found for customerId
- returns early when priceId missing from invoice line item
- updates `user.plan = GOLD` when priceId matches GOLD
- updates `user.plan = PLATINUM` when priceId matches PLATINUM
- sends downgrade email when PLATINUM→GOLD
- does NOT send downgrade email on first payment (FREE→GOLD)

`handle — customer.subscription.deleted`:
- returns early when user not found
- sets `plan: FREE, stripePriceId: null` and sends cancellation email

`handle — customer.subscription.updated`:
- returns early when user not found
- returns early when `cancel_at_period_end: true` (scheduled cancel, not immediate)
- returns early when subscription status is not `active`
- updates plan and stripePriceId on active subscription
- sends downgrade email when PLATINUM→GOLD

`handle — unknown event type`:
- does nothing (no repository or mail calls)

- [ ] Write all test cases above
- [ ] Run `npm test -- --testPathPattern billing.webhook` — all pass
- [ ] Run `npm run lint` — no errors
- [ ] Commit: `test(billing): add unit tests for BillingWebhookHandler`
