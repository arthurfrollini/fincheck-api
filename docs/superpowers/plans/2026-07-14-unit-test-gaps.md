# Close Application-Layer Unit Test Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** This codebase's unit tests are scoped to the `application`/`domain` layer only (infra/http is e2e's job — see docs/superpowers/plans/2026-07-14-e2e-tests.md and 2026-07-14-coverage-95.md for that split). Within that layer, some files have no unit test at all, and two existing spec files are incomplete. This plan closes those specific gaps so the application/domain layer has real, fast, isolated unit coverage of its own — independent of whether e2e happens to exercise the same logic through HTTP.

**Context:** Combined (unit+e2e merged) coverage is already 96.88%+ — this plan does NOT target that number. It targets unit-suite-only quality: can a developer verify this business logic broke without spinning up the e2e suite and a real Postgres DB?

**Tech stack:** Jest, `@nestjs/testing`'s `Test.createTestingModule` with mocked providers — same pattern as every existing `*.service.spec.ts` in this codebase.

## Global Constraints

- Every mocked provider needs jest.fn() stubs for EVERY method the service under test actually calls — read the real service file first, don't assume the sibling spec file's mock shape is complete (see Task 3's note: the existing `transactions.service.spec.ts`'s `PlanGuardService` mock is missing `validateBankAccountIsActive`, which `TransactionsService.create()` calls — this exact gap is why `create()`/`update()`/`remove()` were never testable with the current mock and are the reason those methods show 0% today)
- Match each sibling spec file's existing style (mock shape via plain objects with `jest.fn()`, `Test.createTestingModule` compile pattern, `jest.mock('@shared/config/env', ...)` at the top where needed) — do not introduce a new testing style
- Run `npx jest <file>` after each task and the full `npm run test:unit` once before committing

---

### Task 1: Ownership validator unit tests (3 files)

**Files:**
- Create: `src/modules/bank-accounts/application/validate-bank-account-ownership.service.spec.ts`
- Create: `src/modules/categories/application/validate-category-ownership.service.spec.ts`
- Create: `src/modules/transactions/application/validate-transaction-ownership.service.spec.ts`

**Interfaces:** none new — all 3 services are structurally identical: `validate(userId, entityId)` calls `repository.findFirst(entityId, userId)`, returns the entity if found, throws `NotFoundException` if not.

**Real source for each (read before writing — confirm nothing has changed):**
- `src/modules/bank-accounts/application/validate-bank-account-ownership.service.ts`
- `src/modules/categories/application/validate-category-ownership.service.ts`
- `src/modules/transactions/application/validate-transaction-ownership.service.ts`

- [ ] **Step 1: Write all 3 spec files**, each following this shape (adjust names per file — repository token, service class, error message string):

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ValidateBankAccountOwnershipService } from './validate-bank-account-ownership.service';
import { BankAccountsRepository } from '../domain/repositories/bank-accounts.repository';

describe('ValidateBankAccountOwnershipService', () => {
  let service: ValidateBankAccountOwnershipService;
  let mockRepository: { findFirst: jest.Mock };

  beforeEach(async () => {
    mockRepository = { findFirst: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidateBankAccountOwnershipService,
        { provide: BankAccountsRepository, useValue: mockRepository },
      ],
    }).compile();

    service = module.get(ValidateBankAccountOwnershipService);
  });

  it('returns the entity when found', async () => {
    const entity = { id: 'account-1', userId: 'user-1' };
    mockRepository.findFirst.mockResolvedValue(entity);

    const result = await service.validate('user-1', 'account-1');

    expect(result).toEqual(entity);
    expect(mockRepository.findFirst).toHaveBeenCalledWith(
      'account-1',
      'user-1',
    );
  });

  it('throws NotFoundException when not found', async () => {
    mockRepository.findFirst.mockResolvedValue(null);

    await expect(service.validate('user-1', 'account-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
```

  Verify the exact `NotFoundException` message string in each real service file (e.g. `'Bank account not found.'`, `'Category not found.'`, `'Transaction not found.'`) and assert on it (`rejects.toThrow('Bank account not found.')` or similar) rather than just the exception class, so a message typo would be caught.

- [ ] **Step 2: Run and verify**

```bash
npx jest validate-bank-account-ownership validate-category-ownership validate-transaction-ownership
```

Expected: 6 tests pass (2 per file).

- [ ] **Step 3: Commit**

```bash
git add src/modules/bank-accounts/application/validate-bank-account-ownership.service.spec.ts src/modules/categories/application/validate-category-ownership.service.spec.ts src/modules/transactions/application/validate-transaction-ownership.service.spec.ts
git commit -m "test: add unit tests for the 3 ownership validator services"
```

---

### Task 2: categories.service.spec.ts (new file)

**Files:**
- Create: `src/modules/categories/application/categories.service.spec.ts`

**Interfaces:**
- `CategoriesService` constructor deps: `CategoriesRepository`, `ValidateCategoryOwnershipService`, `PlanGuardService` (read `src/modules/categories/application/categories.service.ts` for the exact method bodies before writing — it was already read once this session: `findAllByUserId`, `create` (calls `planGuardService.validateCategoryAccess`), `update` (calls `Promise.all([validateCategoryAccess, ownership.validate])`), `remove` (same `Promise.all` shape))
- Follow `src/modules/bank-accounts/application/bank-accounts.service.spec.ts`'s established pattern closely — same shape of service (repository + ownership validator + plan guard), most similar sibling in this codebase

- [ ] **Step 1: Read `src/modules/categories/application/categories.service.ts` and `src/modules/bank-accounts/application/bank-accounts.service.spec.ts` first.**

- [ ] **Step 2: Write `categories.service.spec.ts` covering:**
  - `findAllByUserId`: calls `categoriesRepository.findAllByUserId(userId)`, returns its result directly
  - `create`: calls `planGuardService.validateCategoryAccess(userId)` before creating; propagates `ForbiddenException` if that throws (assert `categoriesRepository.create` was NOT called in that case); on success, calls `categoriesRepository.create` with the right shape
  - `update`: calls both `planGuardService.validateCategoryAccess` and `validateCategoryOwnershipService.validate` (via `Promise.all`); propagates either's rejection; on success, calls `categoriesRepository.update` with the right shape
  - `remove`: same dual-validation shape as `update`; on success, calls `categoriesRepository.delete`

- [ ] **Step 3: Run and verify**

```bash
npx jest src/modules/categories/application/categories.service.spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/categories/application/categories.service.spec.ts
git commit -m "test: add categories.service unit tests"
```

---

### Task 3: Complete transactions.service.spec.ts

**Files:**
- Modify: `src/modules/transactions/application/transactions.service.spec.ts` (existing — only tests `findAllByUserId` today; `create`, `update`, `remove`, and the private `validateEntitiesOwnership` are all untested, 0% on lines 23-31 and 66-101)

**Known bug in the existing file to fix while you're in there:** the existing `makeService()` helper's `PlanGuardService` mock only stubs `validateDailyTransactionLimit` — but `TransactionsService.create()` (`transactions.service.ts:27-28`) ALSO calls `this.planGuardService.validateBankAccountIsActive(userId, bankAccountId)`. Any test that calls `service.create(...)` with the current mock will throw `TypeError: ... validateBankAccountIsActive is not a function`. Add that method to the mock (`validateBankAccountIsActive: jest.fn()`) before writing `create` tests.

- [ ] **Step 1: Read `src/modules/transactions/application/transactions.service.ts` in full (already read once this session — re-read to confirm current state) and the existing spec file.**

- [ ] **Step 2: Fix the `PlanGuardService` mock** in `makeService()` to include `validateBankAccountIsActive: jest.fn()` alongside the existing `validateDailyTransactionLimit: jest.fn()`.

- [ ] **Step 3: Add a `describe('create', ...)` block:**
  - Calls `validateBankAccountOwnershipService.validate`, `validateCategoryOwnershipService.validate`, `planGuardService.validateDailyTransactionLimit`, and `planGuardService.validateBankAccountIsActive` — assert all 4 were called with correct args (this is the whole point of the `Promise.all` in `create()`/`validateEntitiesOwnership()` — prove every check actually runs, not just that the call didn't throw)
  - Propagates rejection if any one of the 4 checks throws (pick one, e.g. ownership validation, and assert `transactionsRepository.create` was NOT called)
  - On success, calls `transactionsRepository.create` with the correct shape, including `date: new Date(date)` conversion from the DTO's string/date input

- [ ] **Step 4: Add a `describe('update', ...)` block:**
  - Calls `validateEntitiesOwnership` with `transactionId` included this time (verify via the 3 ownership-validator mocks being called, not just `validateBankAccountOwnershipService`/`validateCategoryOwnershipService` as in `create`)
  - On success, calls `transactionsRepository.update` with the correct shape

- [ ] **Step 5: Add a `describe('remove', ...)` block:**
  - Calls `validateTransactionOwnershipService.validate`
  - On success, calls `transactionsRepository.delete`

- [ ] **Step 6: Run and verify**

```bash
npx jest src/modules/transactions/application/transactions.service.spec.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/transactions/application/transactions.service.spec.ts
git commit -m "test: cover TransactionsService create/update/remove and fix incomplete PlanGuardService mock"
```

---

### Task 4: Complete users.service.spec.ts

**Files:**
- Modify: `src/modules/users/application/users.service.spec.ts` (existing — tests `getUserById`, `updateMe`, `requestEmailChange`, `confirmEmailChange` today; `listAll`, `createByAdmin`, `update`, `delete` are untested, 0% on lines 36-46 and 71-80 — these are the admin-only methods behind `@IsAdministrator()` on the controller side, already e2e-tested via `test/e2e/admin.e2e-spec.ts` but never unit-tested)

- [ ] **Step 1: Read `src/modules/users/application/users.service.ts` in full (already read once this session — re-read to confirm current state) and the existing spec file.**

- [ ] **Step 2: Add a `describe('listAll', ...)` block:**
  - Calls `usersRepository.findMany()`, returns its result directly

- [ ] **Step 3: Add a `describe('createByAdmin', ...)` block:**
  - Hashes the password before creating (this file already mocks `bcryptjs`'s behavior indirectly? check — if not, you may need `jest.mock('bcryptjs', ...)` or assert loosely that `usersRepository.create` was called with a `password` field that is NOT the plaintext input, since `hash()` from `bcryptjs` is real here unless mocked)
  - Calls `usersRepository.create` with `{ name, email, password: <hashed>, role }` (the exact fields `createByAdmin` builds — verify against real source, don't assume)

- [ ] **Step 4: Add a `describe('update', ...)` block:**
  - Throws `NotFoundException` when `findById` returns null (assert `usersRepository.update` was NOT called)
  - On success, calls `usersRepository.update` with `{ name, email, role }`

- [ ] **Step 5: Add a `describe('delete', ...)` block:**
  - Throws `NotFoundException` when `findById` returns null (assert `usersRepository.delete` was NOT called)
  - On success, calls `usersRepository.delete`

- [ ] **Step 6: Run and verify**

```bash
npx jest src/modules/users/application/users.service.spec.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/users/application/users.service.spec.ts
git commit -m "test: cover UsersService admin methods (listAll, createByAdmin, update, delete)"
```

---

### Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

```bash
npm run test:unit -- --coverage
```

- [ ] **Step 2: Confirm the 5 target files now show meaningfully higher unit-only coverage** (not necessarily 100% — some branches, like a `Promise.all` element evaluating to `false` when an optional id is omitted in `validateEntitiesOwnership`, may still show as partial; that's fine, the goal was closing the "zero unit coverage" gaps, not chasing 100% on every branch).

- [ ] **Step 3: Run `npm test`** (the combined script) to confirm the combined number didn't regress and ideally improved further.

- [ ] **Step 4: Report the before/after unit-only percentage for the 5 target files.**
