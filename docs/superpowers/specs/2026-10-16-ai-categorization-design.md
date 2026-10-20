# AI Transaction Categorization — Design Spec

**Subsystem A of the AI features RFC** (`2026-10-16-ai-features-rfc.md`). First of four; establishes `src/shared/llm/` (client, usage/cost accounting, typed failure handling) that subsystems B, C and D reuse. The eval golden set and the real-call eval workflow are subsystem D and get their own spec; this spec only covers what A needs to be testable without an API key.

## Problem

`Transaction.name` is free text (bank-statement style: `IFD*RESTAURANTE X`, `UBER *TRIP`, `PAG*JOSEDASILVA`). Today the client must pick a category on every create: `CreateTransactionDto.categoryId` is required (`@IsNotEmpty @IsUUID`). There is no way to create a transaction and let the system decide.

Goal: a transaction created **without** a `categoryId` gets one inferred by Claude from its `name`, `type` and `value`, chosen from that user's own categories, without slowing down or endangering the create request.

## Decisions (made during brainstorming)

1. **Trigger: async via BullMQ** (RFC option A2). The transaction is saved with `categoryId: null`, a job is enqueued, a worker categorizes it. Mirrors `MailQueueService`.
2. **Model: `claude-haiku-5-5` in production.** Classification is the canonical small-model task (~$0.00006 per transaction at $0.10 / $0.50 per MTok). The golden set in subsystem D also runs against `claude-opus-5-5` so the choice is backed by a measured accuracy/cost comparison rather than asserted.
3. **`categoryId` becomes optional on create.** Sent → respected as today, nothing is enqueued. Omitted → saved as `null` and enqueued. `UpdateTransactionDto` inherits the optional field; an update that omits it keeps the existing category (Prisma ignores `undefined`), and **updates never trigger categorization**.
4. **Candidate set is filtered by type.** The model only sees the user's categories whose `type` matches the transaction's `type` (an `EXPENSE` competes among expense categories only).
5. **Usage accounting: pino log + Prometheus counters** (RFC option F3c), reusing the existing OpenTelemetry `PrometheusExporter`.
6. **Retries are owned by BullMQ, not the SDK.** The Anthropic client is constructed with `maxRetries: 0` so a failing call is retried once per job attempt, not `3 × attempts` times, and `timeout: 30_000` so a hung call cannot hold the worker for the SDK's 10-minute default.

## Architecture

### `src/shared/llm/` (new, flat shared module like `shared/mail/`)

- **`llm.module.ts`** — `@Global()` module exporting `LlmService`.
- **`llm.service.ts`** — owns the single `Anthropic` client (`createAnthropicClient`: `maxRetries: 0`, `timeout: 30_000`, key from `ANTHROPIC_API_KEY`). Exposes one method used by every feature:

  ```ts
  parse<T>(feature: LlmFeature, params: LlmParams, schema: ZodType<T>, context?): Promise<Message & { parsed_output: T | null }>
  ```

  It calls `client.messages.create(...)`, validates the first text block with the zod schema itself (refusal/max_tokens are never parsed; invalid JSON or schema mismatch → `parsed_output: null`), then **always** records usage. It does not use `messages.parse`: that throws on schema mismatch, which would lose the usage record and turn a bad answer into a retried, re-billed job. It (log + metrics) from `response.usage`, including on non-`end_turn` stop reasons. It does not swallow errors: typed SDK errors propagate to the caller, which decides retryable vs not (see failure matrix). `LlmFeature` is a string union (`'categorization'` now; `'agent' | 'rag' | 'judge'` later).
- **`llm-pricing.ts`** — per-model price table (input, output, cache write, cache read, per MTok) for the models in use (`claude-haiku-5-5`, `claude-opus-5-5`) and `computeCostUsd(model, usage)`. Haiku 5.5 has a second rate card above 100K prompt tokens; categorization prompts are far below it, so the function uses the ≤100K card and logs a warning if `input_tokens` exceeds 100K. Thinking tokens are billed as output and are already included in `usage.output_tokens`.
- **`llm.metrics.ts`** — OpenTelemetry counters on the existing `finwise-api` meter, same mechanism as `billing.metrics.ts`:
  - `finwise_llm_tokens` (`{model, feature, direction}`; direction ∈ `input | output | cache_read | cache_write`)
  - `finwise_llm_cost_usd` (`{model, feature}`)
  - `finwise_llm_requests` (`{model, feature, outcome}`; outcome ∈ `ok | refusal | max_tokens | unparsed | error`). This is the API-call layer only: `unparsed` means `parsed_output` came back null. `LlmService` cannot see feature-level checks like ownership.

  Feature-level results get their own counter, owned by the feature: `finwise_categorization_results` (`{result}`; result ∈ `categorized | uncategorized | skipped | rejected | failed`), emitted by `CategorizeTransactionService`. `rejected` = the model's answer failed ownership/type validation.

  The OTel Prometheus exporter appends `_total` to monotonic counters, so they surface as `finwise_llm_tokens_total` etc. The builder should confirm the exported names on `:9464/metrics` and adjust if the exporter also appends a unit suffix.
- **Per-call log line** (pino, `info`): `{feature, model, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, cost_usd, latency_ms, stop_reason}` plus caller-supplied context (`transactionId`). **The transaction `name` is never logged**: it is user financial data and lands in Loki.

### Categorization (in the transactions feature module)

Categorization is a transactions concern, so it lives in `src/modules/transactions/`, not in `shared/llm/`. (This deviates from the RFC's file sketch, which put the queue under `shared/llm/`.)

- **`application/categorize-transaction.service.ts`** — `categorize(userId, transactionId): Promise<CategorizationOutcome>`:
  1. Load the transaction scoped by `userId` (`findFirst(id, userId)`). Missing, or `categoryId` already set → return `skipped` (deleted, or the user categorized it manually in the meantime).
  2. Load the user's categories with matching `type`. Empty → return `skipped`.
  3. Build the request (below) and call `LlmService.parse('categorization', ...)`.
  4. Check `stop_reason`: `refusal` / `max_tokens`, or `parsed_output` null → return `failed`.
  5. `categoryId === 'none'` or `confidence < CATEGORIZATION_MIN_CONFIDENCE` → return `uncategorized` (stays `null`).
  6. **Ownership validation**: the returned id must belong to this user **and** have the transaction's type. The structured-output enum already restricts it to ids from step 2; this check is the authorization layer and must not rely on the schema. Uses `ValidateCategoryOwnershipService` (catch its `NotFoundException`) plus a type comparison. Failure → `rejected`, logged at `warn`.
  7. Write with a **conditional update**: `setCategoryIfUnset(transactionId, userId, categoryId)` → `updateMany({ where: { id, userId, categoryId: null }, data: { categoryId } })`, returns whether a row changed. This closes the race where the user sets a category manually while the job is in flight. The model never overwrites a human choice.
  8. Return `categorized`.

- **Request shape**:
  - `model: CATEGORIZATION_MODEL` (`'claude-haiku-5-5'`; overridable by parameter so the eval can run Opus 5.5 through the same code path).
  - `max_tokens: 1024`: thinking counts toward `max_tokens` on Haiku 5.5, so a tight cap like 50 would truncate before the answer.
  - `output_config: { effort: 'low', format: { type: 'json_schema', schema } }` with a **hand-built** JSON schema. Not `zodOutputFormat`: the SDK's transform strips `enum` into a description hint, while the API enforces `enum`. The API does not support `minimum`/`maximum`, so the confidence range is validated client-side by the zod schema. Thinking is left at its default (adaptive). Effort is the lever, not `disabled`. No `temperature` (non-default sampling params return 400 on Haiku 5.5), no prefill.
  - Schema built per request: JSON schema `categoryId: { enum: ['none', ...candidateIds] }`, `confidence: number`; zod mirror `z.object({ categoryId: z.enum(['none', ...candidateIds]), confidence: z.number().min(0).max(1) })` for client-side validation. `'none'` is a string sentinel rather than `null`, keeping the enum flat.
  - System prompt (English, fixed): the task, that inputs are Brazilian bank-statement descriptions (merchant prefixes like `IFD*`, `MP*`, `PAG*`, installment suffixes like `03/10`), that `'none'` is preferred over a guess, and that the user's catch-all category ("Outro") is a valid answer when it fits. User message: the candidate list (`id`, `name`), then `name`, `type`, `value`. Exact wording is the builder's; the golden set (D) is what judges it.
  - Read content blocks by `type`; a Haiku 5.5 response can begin with `thinking` blocks.

- **`CATEGORIZATION_MIN_CONFIDENCE`**: start at `0.5`. Self-reported confidence is poorly calibrated; D measures whether the floor improves precision at acceptable recall loss, and the constant is tuned from that. The confidence value is logged, not stored.

### Queue

Mirrors `shared/mail/` file-for-file, under `src/modules/transactions/infra/queue/`:

- **`categorization-job.types.ts`** — `CATEGORIZATION_QUEUE_NAME = 'categorization'`, `CATEGORIZE_TRANSACTION_JOB_NAME`, `CategorizeTransactionJobData { userId, transactionId }`, retry/retention constants: `attempts: 5`, built-in `exponential` backoff with `delay: 2000` (2s, 4s, 8s, 16s, about 30s total), completed retention 1 day, failed 7 days (same reasoning as mail).
- **`categorization-queue.service.ts`** — `enqueue(userId, transactionId)`. Registers the `'error'` listener on the `Queue` (same crash reason as mail). **Catches and logs instead of throwing**: Redis down must not fail `POST /transactions`; the transaction simply stays uncategorized. Uses `jobId: categorize-${transactionId}` so a double enqueue of the same transaction is a BullMQ no-op. (Colon-free on purpose; BullMQ uses `:` as its key separator.)
- **`categorization.processor.ts`** — `@Processor(CATEGORIZATION_QUEUE_NAME, { drainDelay: 1 })` (same teardown-race mitigation as `MailProcessor`), `@OnWorkerEvent('error')` listener, `process(job)` calls `CategorizeTransactionService.categorize` and maps errors per the failure matrix: retryable → rethrow (BullMQ retries); non-retryable → `throw new UnrecoverableError(...)` (from `bullmq`) so it fails once without burning attempts.
- `BullModule.registerQueue({ name: CATEGORIZATION_QUEUE_NAME })` in `TransactionsModule`. `BullModule.forRootAsync` already lives in `MailModule` (global), so no second root connection.

### Wiring into create

`TransactionsService.create`: after `transactionsRepository.create(...)`, if the DTO had no `categoryId`, `await categorizationQueueService.enqueue(userId, transaction.id)`. The enqueue never throws, so the create's response and status are unchanged. The response carries `categoryId: null`; the client sees the category on its next read.

`validateEntitiesOwnership` already skips the category check when `categoryId` is undefined; no change.

### Config

- `ANTHROPIC_API_KEY` added to `env.ts` (`@IsString() @IsNotEmpty()`), `.env.example`, and **the CI `.env.test` block** with a fake value (`ANTHROPIC_API_KEY=fake-anthropic-key`). Without the CI line, every CI job fails at import.
- No other new env vars. Model and thresholds are code constants. They change through a PR that the eval checks, not through deploy config.

## Failure matrix

| Scenario | Behavior |
|---|---|
| Redis down at enqueue | Caught and logged in `CategorizationQueueService`; `POST /transactions` succeeds; transaction stays `null`. |
| `RateLimitError` (429), `InternalServerError` / other `APIStatusError` ≥ 500, `APIConnectionError`, timeout | Rethrown → BullMQ retries with exponential backoff, 5 attempts. After the last, job lands in failed set (7-day retention); transaction stays `null`. Usage is recorded for every attempt that got a response. |
| `AuthenticationError`, `PermissionDeniedError`, `BadRequestError`, `NotFoundError` (any 4xx except 408/409/429), or an `AnthropicError` with no HTTP status | `UnrecoverableError` → no retry (retrying a bad key or bad request cannot succeed). Logged at `error`; `outcome=error`. |
| `stop_reason: 'refusal'` | No retry, stays `null`, `outcome=refusal`. Haiku 5.5 has no server-side fallback; a bank-statement string tripping a classifier is rare enough to accept. |
| `stop_reason: 'max_tokens'` or `parsed_output` null | No retry, stays `null`, `outcome=max_tokens` / `unparsed`, `result=failed`. Repeated occurrences are a prompt/cap bug to see in Grafana, not a transient to retry. |
| Model returns `'none'` or confidence below floor | Stays `null`. Not an error. `outcome=ok`, `result=uncategorized`. |
| Returned id fails ownership/type check | Not written. `warn` log with ids (never the name). `outcome=ok`, `result=rejected`. |
| Transaction deleted, or user set a category, before the job runs | Step 1 skips, or step 7's conditional update changes 0 rows. Human choice wins. |
| Same transaction enqueued twice | Deduplicated by `jobId`. |

**Error classification uses the SDK's typed classes, most specific first** (`AuthenticationError` → `PermissionDeniedError` → `BadRequestError` → `NotFoundError` → `RateLimitError` → `APIStatusError` by status → `APIConnectionError`), never message string matching.

## Testing

None of this needs a real API key. Main CI stays keyless.

- **Unit, `llm-pricing`**: cost for known usage on each model; cache read/write tokens priced separately.
- **Unit, `LlmService`**: with a mocked `Anthropic` client: usage logged and the three `finwise_llm_*` counters incremented on success, and on `refusal` / `max_tokens` / `unparsed`; SDK errors propagate unchanged and count as `outcome=error`.
- **Unit, `CategorizeTransactionService`**: `LlmService` mocked, fed **fixtures**: JSON files under `test/fixtures/llm/categorization/` in the exact shape `messages.parse` returns (content blocks including a leading `thinking` block, `parsed_output`, `usage`, `stop_reason`). Cases: happy path; `'none'`; below-floor confidence; refusal; max_tokens; null `parsed_output`; returned id belonging to another user (must not write); returned id of the wrong type (must not write); transaction already categorized (skipped); conditional update hits 0 rows; no candidate categories (skipped); request uses only same-type categories, `effort: 'low'` and no `temperature`.
- **Unit, processor**: each error class maps to rethrow vs `UnrecoverableError` per the matrix.
- **Unit, queue service**: enqueue options (attempts, backoff, retention, `jobId`); Redis failure is caught, not thrown.
- **Unit, `TransactionsService.create`**: enqueues when `categoryId` absent; does not when present.
- **E2E**: `test/helpers/create-app.ts` overrides `LlmService` with a mock (external boundary, same as `MailService`). `POST /transactions` without `categoryId` → 201 with `categoryId: null`; mock returns a valid category; poll `GET /transactions` until categorized (bounded wait). With `categoryId` → mock never called.

**Fixtures before the key exists:** handwritten in the documented response shape, marked `"recorded": false`. Once `ANTHROPIC_API_KEY` is available, `scripts/record-llm-fixtures.ts` (run manually, never in CI) re-records them from real Haiku 5.5 calls and flips the flag. The real-call golden set and its CI workflow are subsystem D.

## Files touched

New: `src/shared/llm/{llm.module,llm.service,llm-pricing,llm.metrics}.ts` (+ specs); `src/modules/transactions/application/categorize-transaction.service.ts` (+ spec); `src/modules/transactions/infra/queue/{categorization-job.types,categorization-queue.service,categorization.processor}.ts` (+ specs); `test/fixtures/llm/categorization/*.json`; `scripts/record-llm-fixtures.ts`.

Changed: `create-transaction.dto.ts` (`categoryId` → `@IsOptional`, Swagger: "omit to auto-categorize"); `transactions.service.ts` (enqueue); `transactions.repository.ts` + Prisma impl (`setCategoryIfUnset`); `categories.repository.ts` + Prisma impl (find by user and type, if not derivable from `findAllByUserId` cheaply); `transactions.module.ts`; `app.module.ts` (`LlmModule`); `env.ts`; `.env.example`; `.github/workflows/ci.yml` (`.env.test`); `test/helpers/create-app.ts`; `package.json` (`@anthropic-ai/sdk`, `zod`. Check the SDK's `zodOutputFormat` helper against the installed zod major).

No Prisma migration: `Transaction.categoryId` is already nullable.

## Out of scope

- Backfill of existing uncategorized transactions (RFC option A4, Batches API). Natural follow-up; not needed for the feature to work.
- Re-categorizing on update or on name change.
- Learning from user corrections / few-shot from the user's history.
- Storing confidence in the database, or exposing it in the API.
- Per-plan gating or per-user quotas. The existing daily transaction limit already bounds calls per user.
- Prompt caching: the prompt is well under the minimum cacheable prefix.
- Golden set, LLM-as-judge, baseline, `evals.yml`: subsystem D.
