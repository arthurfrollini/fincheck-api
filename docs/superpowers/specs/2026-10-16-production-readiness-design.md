# Production Readiness — Design Spec

**Context:** finwise is going to a public URL. It stays a study project whose main user is the owner, but a public URL means open signup, internet-wide scanners and API endpoints that spend real money (Claude API, prepaid credit). This spec is everything that has to be true **before** the first deploy. Hosting and the deploy itself are a separate spec.

## Threat model (what this protects against)

| Threat | Likelihood | Today | After |
|---|---|---|---|
| Generic scanners, password guessing on `/auth/signin`, mass signups | **certain** on any public URL | no rate limiting at all | per-IP throttling, strict on auth |
| Free accounts created in bulk to spend Claude credit on RAG/agent | low, but cheap to exploit | unlimited for every plan | **FREE gets no RAG/agent**; paid plans have daily quotas |
| Many accounts or a bug running up spend in one day | low | bounded only by the prepaid balance | **global daily spend ceiling** (US$ 1) |
| Becoming GOLD for free with Stripe's test card `4242…` | certain if billing is exposed in test mode | exposed | **billing off in production**; plans set by an admin |
| Welcome emails to the owner's inbox for every signup | certain | hard-coded recipient | recipient from config; mail off in production |

The prepaid Anthropic balance, with no auto-reload, stays the last line: the worst case is losing that balance, never more.

## Decisions (made with the owner)

1. **AI quotas per plan, per UTC day** (same day boundary as `transactionsPerDay`):

   | Plan | Categorization | RAG questions | Agent questions |
   |---|---|---|---|
   | FREE | yes | **0** | **0** |
   | GOLD | yes | 20 | 20 |
   | PLATINUM | yes | 50 | 50 |
   | ADMINISTRATOR | yes | unlimited | unlimited |

   - Categorization needs no quota of its own. It costs ~US$ 0.0001 per transaction and is already bounded by `transactionsPerDay` (FREE: 50/day ≈ half a cent).
   - PLATINUM is capped even though it is "unlimited" for transactions: every AI call costs money.
   - New fields on `PLAN_LIMITS`: `ragQuestionsPerDay`, `agentQuestionsPerDay` (`Infinity` for ADMINISTRATOR).
2. **Global daily AI spend ceiling: US$ 1/day** across all users and features, from env `AI_DAILY_SPEND_LIMIT_USD` (default `1`).
   - Once today's recorded spend reaches it, RAG and agent requests get **503** ("AI temporarily unavailable, try again tomorrow").
   - Categorization jobs complete without calling the model, so the transaction stays uncategorized, consistent with "an AI failure never fails a write".
3. **Usage is recorded in Postgres**, not only Prometheus, because the counters reset on restart. A new `AiUsage` row is written per model call: `userId?`, `feature`, `model`, `inputTokens`, `outputTokens`, `costUsd`, `createdAt`. This is option F3b from the RFC, deferred there "until per-user quota is coming". It now is.
4. **Rate limiting** with `@nestjs/throttler`, applied as a global guard, keyed by client IP:
   - default **100 requests/min**;
   - `POST /auth/signin`, `/auth/signup`, `/auth/refresh`: **5/min**;
   - `POST /education/questions` and `/assistant/questions`: **10/min**, a burst guard on top of the daily quotas.

   Over the limit: **429** with `Retry-After`. Behind the hosting proxy, Express must trust the proxy (`app.set('trust proxy', 1)`, gated by env `TRUST_PROXY`), or every request looks like one IP.
5. **Billing can be switched off**: env `BILLING_ENABLED` (default `true`, so local and CI are unchanged).
   - When `false`, every `/billing/*` route except the Stripe webhook returns **404**.
   - Production runs with billing off; Stripe stays in test mode for local study.
   - Plans in production are changed only by an admin.
6. **Admin can set a user's plan.** `UpdateUserDto` (admin `PATCH /users/:id`) gains an optional `plan` (enum `Plan`).
7. **Bootstrap the first admin:** `npm run admin:promote -- <email>` sets `role` and `plan` to `ADMINISTRATOR` for an existing user. Run once against the production database. From then on, the owner manages plans through the API, including the GOLD **demo account** for interviews.
8. **Mail delivery is configured, not hard-coded.**
   - The hard-coded owner address in `AuthService` is removed, and mail goes to the user's own address.
   - **`MAIL_REDIRECT_TO`** (optional): when set, every email goes there instead. Local `.env` sets it to the owner's address, which keeps today's dev behavior.
   - **`MAIL_ENABLED`** (default `true`): when `false`, mail jobs complete without sending. Production runs with `false` until Resend has a verified domain. Otherwise every send would fail and retry 60 times.
9. **`npm run start:prod` works.** `prisma.config.ts` at the repo root is compiled into the build, which nests output under `dist/src/`, while `start:prod` runs `node dist/main`. Exclude it from `tsconfig.build.json` so output lands in `dist/` (a test asserts `dist/main.js` exists after `nest build`).

## Architecture

- `src/shared/plan/plan.constants.ts`: the two new quota fields.
- `src/shared/plan/plan-guard.service.ts`:
  - `validateDailyAiQuota(userId, feature: 'rag' | 'agent')`: **403** "Your plan includes N … per day" (FREE: "AI features require a GOLD or PLATINUM plan");
  - `validateGlobalAiBudget()`: **503**.
- `src/shared/llm/`: an `AiUsageRepository` (Prisma). `LlmService` records a row per call when the caller passes `userId` in its context. Evals and scripts construct `LlmService` without a recorder, so they don't write rows.
- **Counting:**
  - RAG: today's `AiUsage` rows with `feature='rag'` for the user. Questions that never reach the model ("not covered") don't count.
  - Agent: today's `AgentRun` rows for the user. Idempotent repeats return the same run, so they aren't double-counted.
  - Global: `SUM(costUsd)` of today's `AiUsage` rows.
- **Checks run before any model call:**
  - in `AnswerQuestionService` before retrieval;
  - in `AssistantService.ask` before registering the run (a rejected question creates no run);
  - in `CategorizeTransactionService` before the model (budget only).
- **Accepted race:** concurrent requests can overshoot a quota by a few calls, or the ceiling by a few cents. That's acceptable for the cost involved, and a lock isn't warranted.

## Failure matrix

| Case | Result |
|---|---|
| FREE user asks RAG/agent | 403, no model call, nothing recorded |
| GOLD user, 21st RAG question today | 403 naming the limit |
| Global spend ≥ ceiling | RAG/agent 503; categorization leaves `categoryId` null (job completes, logged) |
| 6th sign-in attempt in a minute from one IP | 429 with `Retry-After` |
| `BILLING_ENABLED=false`, `POST /billing/subscribe` | 404 |
| `BILLING_ENABLED=false`, Stripe webhook | still processed (signature-checked as today) |
| `MAIL_ENABLED=false`, signup | 201; mail job completes without sending |
| Usage row write fails after a successful model call | logged; the answer is still returned (accounting never fails the user's request) |

## Testing

- **Unit:**
  - quota and budget checks for every plan, including the boundary (20th allowed, 21st refused) and ADMINISTRATOR bypass;
  - usage recording with and without `userId`;
  - mail redirect and disable;
  - billing routes 404 when disabled, with the webhook unaffected;
  - `admin:promote` logic.
- **E2E:**
  - FREE → 403 on both AI endpoints;
  - GOLD within quota → 200/202, over quota → 403;
  - budget exhausted (seeded `AiUsage`) → 503;
  - signin throttled → 429.

  The throttler limits come from config, so e2e can set tight values without slowing the suite.
- **Build:** `nest build` produces `dist/main.js`.

## Out of scope

- Hosting choice, deploy pipeline, domain, production observability: these are the deploy spec.
- Real payments (Stripe live mode): the owner chose test mode only. Live mode would bring identity verification, invoices, taxes, LGPD terms and chargebacks.
- CAPTCHA or email verification at signup: FREE has no AI access, so bulk signups cost nothing beyond rate-limited requests.
- Per-user spend ceilings in USD (quotas count questions, which is simpler to explain to a user).
