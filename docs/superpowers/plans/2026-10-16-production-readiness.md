# Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make finwise safe to put on a public URL: per-plan AI quotas and a global daily AI spend ceiling (recorded in Postgres), IP rate limiting, billing switchable off, admin-managed plans, configurable mail, a working `start:prod`, and a README that documents everything built on 2026-10-16.

**Architecture:** Quotas and the budget live in `PlanGuardService` next to the existing plan limits; usage rows are written by `LlmService` when a caller passes `userId`. Throttling is a global `@nestjs/throttler` guard with named limits. Billing, mail and proxy behavior are env-driven with defaults that keep local and CI unchanged.

**Tech Stack:** NestJS 11, Prisma 6, `@nestjs/throttler@6.7.1`, Jest 30, Supertest.

**Spec:** `docs/superpowers/specs/2026-10-16-production-readiness-design.md`

## Global Constraints

- Quotas per UTC day: FREE rag 0 / agent 0; GOLD 20 / 20; PLATINUM 50 / 50; ADMINISTRATOR `Infinity`. Categorization has no quota.
- `AI_DAILY_SPEND_LIMIT_USD` default `1`. `BILLING_ENABLED` default `true`. `MAIL_ENABLED` default `true`. `MAIL_REDIRECT_TO` optional. `TRUST_PROXY` optional. Throttle limits from env with defaults: `THROTTLE_DEFAULT_LIMIT=100`, `THROTTLE_AUTH_LIMIT=5`, `THROTTLE_AI_LIMIT=10` (all per 60s). **None of these go in `env.ts`**; they are optional, read via `process.env` like `LOKI_URL`, so CI and `.env.test` need no new required vars.
- `.env.test` (local + CI heredoc) sets `THROTTLE_DEFAULT_LIMIT=10000`, `THROTTLE_AUTH_LIMIT=10000` and `THROTTLE_AI_LIMIT=10000`, so the e2e suite (many sign-ups per second from one IP) is not throttled; the throttling e2e sets tight limits on its own app instance.
- Any generated Prisma migration must **not** contain `DROP INDEX "knowledge_chunks_embedding_hnsw_idx"` (Prisma can't express it). Remove that line, and apply with `npx prisma migrate deploy`; `migrate dev` hangs non-interactively.
- Never log question text or tool data. Status codes: quota 403, budget 503, throttle 429, billing disabled 404.
- Every task ends with the full pre-push gate green.

## Review Focus

1. **Quota boundary:** the 20th GOLD RAG question passes and the 21st fails; "not covered" questions don't count. Task 6.
2. **Idempotent agent repeats** must not consume quota: the same `Idempotency-Key` returns the existing run before any quota check. Task 6.
3. **The webhook stays reachable** with billing disabled, or plan changes made earlier via Stripe would stop syncing. Task 3.
4. **The throttle key is the real client IP** behind a proxy: without trust proxy, every user shares one bucket. Task 7.
5. **A failed usage write never fails the user's request.** Task 5.

---

### Task 1: `start:prod` builds to `dist/main.js`
**Files:** `tsconfig.build.json` (exclude `prisma.config.ts`), `.github/workflows/ci.yml` (step after tests: `npm run build && test -f dist/main.js`).
- [ ] Verify the current failure: `npx nest build && ls dist/main.js` → missing.
- [ ] Exclude `prisma.config.ts`; rebuild; `dist/main.js` exists; `node dist/main.js` boots (check the log line "Nest application successfully started"; stop it).
- [ ] Add the CI step; gate; commit `fix(build): emit dist/main.js so start:prod works`.

### Task 2: Mail recipient and delivery from config
**Files:** `src/shared/mail/mail.service.ts` (+ spec), `src/modules/auth/application/auth.service.ts` (+ spec), `.env.example`, local `.env` (`MAIL_REDIRECT_TO=arthur.frollini@gmail.com`).
**Interfaces:** `MailService` resolves the recipient as `process.env.MAIL_REDIRECT_TO || to`. When `process.env.MAIL_ENABLED === 'false'`, it returns without calling Resend and logs at `info`.
- [ ] Failing tests: the redirect replaces `to`; disabled → Resend not called; `AuthService.signup` / Google signup queue the welcome email to the **user's** address (no hard-coded owner address left: grep test).
- [ ] Implement; gate; commit `fix(mail): send to the user, with optional redirect and kill switch`.

### Task 3: Billing switchable off
**Files:** `src/shared/billing/billing-enabled.guard.ts` (+ spec), `billing.controller.ts`.
**Interfaces:** `BillingEnabledGuard` throws `NotFoundException` when `process.env.BILLING_ENABLED === 'false'`; applied to setup, subscribe, change-plan and cancel; **not** to the webhook.
- [ ] Failing tests: the guard allows when unset or `true` and throws 404 when `false`; reflection test that the webhook handler has no guard.
- [ ] Implement; gate; commit `feat(billing): BILLING_ENABLED switch, webhook unaffected`.

### Task 4: Admin-managed plans + promote script
**Files:** `src/modules/users/infra/http/dto/update-user.dto.ts` (optional `plan: Plan`, `@IsEnum`), `users.service.ts` if needed, `scripts/admin-promote.ts`, `src/modules/users/application/promote-admin.ts` (+ spec), `package.json` (`"admin:promote": "ts-node -r tsconfig-paths/register scripts/admin-promote.ts"`).
**Interfaces:** `promoteToAdmin(prisma, email): Promise<{ id: string }>` sets `role` and `plan` to `ADMINISTRATOR` and throws if the user doesn't exist.
- [ ] Failing tests: admin `PATCH /users/:id` with `{ plan: 'GOLD' }` → the plan changes (e2e); a non-admin → 403; `promoteToAdmin` updates both fields, and an unknown email throws.
- [ ] Implement; gate; commit `feat(users): admins can set plans; admin:promote bootstrap script`.

### Task 5: `AiUsage` recording
**Files:** `prisma/schema.prisma` (+ migration, HNSW line removed), `src/shared/llm/ai-usage.repository.ts` (+ prisma impl + spec), `llm.service.ts` (+ spec), callers passing `userId` in context: `categorize-transaction.service.ts`, `answer-question.service.ts`, `run-agent.service.ts`.
**Interfaces:**
- Model `AiUsage { id, userId String? @db.Uuid (FK SetNull), feature String, model String, inputTokens Int, outputTokens Int, costUsd Float, createdAt }`, with index `(createdAt)` and `(userId, feature, createdAt)`.
- `AiUsageRepository.record(row)`, `countForUserToday(userId, feature)`, `spendToday(): Promise<number>`.
- `LlmService` gets an optional `AiUsageRepository` (`@Optional()`) and records after each response when `context.userId` is present. Record failures are caught and logged.
- [ ] Failing tests: a row is recorded with tokens and cost when `userId` is given; nothing is recorded without `userId` or without a repository; a record failure still returns the response; the repository's today window is UTC.
- [ ] Implement; migrate (check for the HNSW drop); gate; commit `feat(llm): record AI usage per call in Postgres`.

### Task 6: Quotas and global budget
**Files:** `src/shared/plan/plan.constants.ts`, `plan-guard.service.ts` (+ spec), `answer-question.service.ts` (signature `answer(userId, question)`), `education.controller.ts` (pass `@ActiveUserId()`), `assistant.service.ts`, `categorize-transaction.service.ts`, specs, `test/e2e/ai-quotas.e2e-spec.ts`.
**Interfaces:**
- `PLAN_LIMITS[plan].ragQuestionsPerDay` and `.agentQuestionsPerDay`.
- `PlanGuardService.validateDailyAiQuota(userId, 'rag' | 'agent')`: 403. FREE gets the message "AI features require a GOLD or PLATINUM plan."; the others "Your plan includes N … per day."
- `PlanGuardService.validateGlobalAiBudget()`: 503 when `spendToday() >= AI_DAILY_SPEND_LIMIT_USD`.
- Agent quota counts today's `AgentRun` rows for the user. RAG quota counts today's `AiUsage` rows with `feature='rag'`.
- **Order in `AssistantService.ask`:** look up an existing run for the idempotency key first and return it; then budget; then quota; then register.
- **RAG order:** budget → quota → retrieval. Not-covered questions record nothing, so they never count.
- **Categorization:** when the budget is exhausted, the result is `'skipped'` and the model is never called.
- [ ] Failing tests: the boundary for each paid plan; FREE 403 on both; ADMINISTRATOR bypass; budget 503; an idempotent repeat at the quota limit still returns the run (no 403); categorization skipped on an exhausted budget. E2E: FREE 403 on both endpoints; a GOLD user over quota (seeded usage rows) gets 403; an exhausted budget (seeded rows) gets 503.
- [ ] Implement; gate; commit `feat(plan): per-plan daily AI quotas and a global daily AI spend ceiling`.

### Task 7: Rate limiting
**Files:** `package.json` (`@nestjs/throttler@6.7.1`), `src/app.module.ts` (`ThrottlerModule.forRoot` with throttlers `default`, `auth`, `ai` from env; `APP_GUARD` ThrottlerGuard), `auth.controller.ts` (`@Throttle({ auth: … })` on signin, signup and refresh, and `@SkipThrottle({ ai: true })` elsewhere as needed), the AI controllers, `src/main.ts` (`if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) \|\| process.env.TRUST_PROXY)`), `.env.test` (local and CI) with high limits, `test/e2e/throttling.e2e-spec.ts`.
- [ ] Failing e2e: an app built with `THROTTLE_AUTH_LIMIT=3` → the 4th signin within a minute → 429 with `retry-after`; other routes are unaffected by the auth bucket.
- [ ] Implement; gate (the whole e2e suite must still pass with the high test limits); commit `feat(security): IP rate limiting with a strict auth bucket`.

### Task 8: README brought up to date
**Files:** `README.md`.
- [ ] Rewrite to reflect the current system (English, factual, no marketing):
  - intro mentions the AI features;
  - **Stack** adds the Claude API (Haiku/Sonnet/Opus 5.5), pgvector, transformers.js and BullMQ, with test counts taken from the gate output;
  - **Modules** adds `education` (RAG) and `assistant` (agent);
  - a new **AI features** section: one paragraph each for categorization, RAG, agent and evals, with the measured numbers (categorization 84% Haiku = Opus at 1/37 of the cost; retrieval recall@5 50%; RAG answers 14/20; agent 8/10) and links to the specs in `docs/superpowers/specs/`;
  - **Plans** table adds the AI rows (FREE none; GOLD 20/20; PLATINUM 50/50) and a note on the global ceiling;
  - **Evals** section: how to run each eval and what gates where (CI vs monthly `evals.yml`);
  - **Environment Variables:** the full current list (Redis, `ANTHROPIC_API_KEY`, and the optional `BULLMQ_PREFIX`, `MAIL_*`, `BILLING_ENABLED`, `AI_DAILY_SPEND_LIMIT_USD`, `THROTTLE_*`, `TRUST_PROXY`);
  - **Production notes:** billing off, plans by admin, `admin:promote`, mail off until a verified domain.
- [ ] Run the humanizer pass on the prose (owner's rule for public text); check links resolve and that no placeholders remain.
- [ ] Commit `docs: document the AI features, evals and production settings`.

## Done when
- Full gate green; `npm run build && node dist/main.js` boots.
- FREE gets 403 on both AI endpoints; GOLD is limited at 20/day; an exhausted budget gets 503; the 6th signin per minute gets 429 (with default limits).
- The README describes everything that exists, with no stale numbers.
