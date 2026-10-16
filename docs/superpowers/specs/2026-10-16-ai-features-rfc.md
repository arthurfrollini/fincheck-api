# AI Features — RFC (options, not yet decided)

**Status: RFC, decisions recorded 2026-10-16** (see "Decisions needed" at the end). This document presents options for four independent AI subsystems. Nothing here is approved or scheduled. Pick per subsystem, then each choice gets its own design spec → implementation plan → PR, following the existing flow (`2026-07-16-stripe-webhook-idempotency-design.md` is the shape of a decided spec).

## Why this exists

Four subsystems are on the table:

| # | Subsystem | What it adds |
|---|---|---|
| A | Transaction categorization | Free-text `Transaction.name` → `categoryId`, via Claude, structured output |
| B | Spending Q&A agent | Natural-language questions over the user's own data, multi-step tool use |
| C | RAG over financial education material | Grounded answers with source citations |
| D | Eval pipeline | Golden sets, exact-match + LLM-as-judge, threshold gating |

They are independent. A is the smallest and unlocks the shared LLM plumbing the other three reuse. D's harness is reusable across A, B, and C. B is the largest. C is self-contained once the corpus lands.

## Current state (what already exists)

Relevant, because most of these options are "extend an existing pattern" rather than "invent one":

- **`Transaction.name`** is free text; **`Transaction.categoryId` is already nullable** (`category Category? @relation(..., onDelete: SetNull)`). Categorization has a natural slot with no schema change to `Transaction`.
- **`Category`** is scoped per user (`userId`), with `name`, `icon`, and `type` (`INCOME`/`EXPENSE`). The candidate label set is per-user, not global — this matters for the prompt and for authorization.
- **BullMQ is wired and in production use.** `MailQueueService` establishes the house pattern: `attempts` + `backoff` + `removeOnComplete`/`removeOnFail` retention caps, an `error` listener on the `Queue` (a missing one crashes the process), and an `enqueue` that **catches and logs instead of throwing** so the caller's write path never fails because Redis is down.
- **Idempotency has an established pattern**: `ProcessedStripeEvent` — a Postgres table with a `@unique` key, register-first, compensate-on-failure. Any new idempotency should mirror it rather than invent a second style.
- **Observability is live**: OpenTelemetry tracing → Jaeger, Prometheus metrics (`PrometheusExporter` on the `NodeSDK`, port 9464), pino → Loki with `trace_id`/`span_id` preserved, all three unified in Grafana.
- **`env.ts` validates every variable at import time and throws if one is missing.** CI writes a `.env.test` with all-fake values. **Consequence: every new env var must be added to the CI `.env.test` block, or CI breaks at import.** This directly constrains subsystem D — see "The CI secret problem".
- **CI** runs on push to `main`, PRs to `main`, and `workflow_dispatch`, with Postgres 17 + Redis services, mirroring `.husky/pre-push` (lint → tsc → prettier → test).
- **Clean Architecture**: feature modules get `domain/repositories` (abstract class as DI token) → `application/*.service.ts` → `infra/http` + `infra/database`. `shared/` is flat services (`billing`, `mail`, `storage`) — no domain/application/infra split.

## Shared foundations (decide once, applies to all four)

### F1. Where the Claude client lives

`shared/llm/` as a flat service module, consistent with `shared/mail/` and `shared/billing/`. It owns the `Anthropic` client, the usage/cost accounting, and the typed errors. Feature modules inject it.

Not a feature module: it has no domain entities and no HTTP surface of its own.

### F2. SDK and model

`@anthropic-ai/sdk`. Client construction is zero-arg (`new Anthropic()`), which resolves `ANTHROPIC_API_KEY` from the environment — same convention as the rest of the project's config.

Model choice is **per feature**, and is a cost decision that belongs to the repo owner, not a default:

| Feature | Default | Cheaper option | Note |
|---|---|---|---|
| A — categorization | `claude-opus-5-5` | `claude-haiku-5-5` | Classification is the canonical cheap task. ~300 in / ~50 out per call. **Decided: Haiku 5.5**, compared against Opus 5.5 in the golden set. |
| B — Q&A agent | `claude-opus-5-5` | `claude-sonnet-5-5` | Multi-step tool use benefits from the stronger model. |
| C — RAG answer | `claude-opus-5-5` | `claude-sonnet-5-5` | Grounded generation over retrieved chunks. |
| D — judge | `claude-opus-5-5` | `claude-haiku-5-5` | Judge quality matters; a weak judge produces a useless eval. |

Pricing (per 1M tokens, first-party API): Opus 5.5 $4 in / $20 out · Sonnet 5.5 $2 / $10 · Haiku 5.5 $0.10 / $0.50 (prompts ≤100K tokens).

Order-of-magnitude for this project: categorization ≈ $0.00006/transaction on Haiku 5.5; a Q&A turn ≈ $0.015 on Opus 5.5; a 50-case eval run ≈ $0.10–0.30. **Building and demoing all four is a $10–30 spend.** Cost is not the constraint; CI *frequency* is (see D).

### F3. Usage and cost accounting

The email-level claim is "token and cost logging per request". Three options:

- **F3a — pino structured log only.** Log `{model, feature, input_tokens, output_tokens, cache_read_input_tokens, cost_usd}` per call. Zero schema change; lands in Loki; queryable in Grafana. Cheapest.
- **F3b — Postgres table.** An `LlmUsage` model. Queryable with SQL, joinable to users, supports per-user quota later. Costs a migration and a write per call.
- **F3c — F3a + Prometheus counters.** Add `fincheck_llm_tokens_total{model,feature,direction}` and `fincheck_llm_cost_usd_total{model,feature}` to the existing `PrometheusExporter`, alongside the existing `fincheck_active_subscriptions` gauge.

**Recommendation: F3c.** It reuses the observability stack already built rather than bolting on a parallel one, and makes LLM cost a first-class dashboard panel next to the existing metrics. F3b only earns its migration if per-user billing or quota is actually coming.

### F4. Failure posture

Every LLM call is a call to an external service that can be slow, rate-limited, or down. House rule to carry over from `MailQueueService`: **an LLM failure must never fail a write the user already made.** Concretely — a transaction is saved whether or not it gets categorized; a Q&A failure returns a degraded answer, not a 500.

Error handling uses the SDK's typed classes, most-specific-first (`NotFoundError` → `RateLimitError` → `APIStatusError` → `APIConnectionError`), never string matching.

---

## Subsystem A — Transaction categorization

**What it does:** a transaction whose `categoryId` is null gets a category inferred from its free-text `name` (plus `type` and `value` as signal), chosen from that user's own `Category` rows.

### A — Options

**A1. Synchronous, inside `POST /transactions`.**
The create handler calls Claude inline and saves the transaction with its category in one go.
*For:* simplest mental model; the client gets the category immediately in the response.
*Against:* adds ~1–2s of LLM latency to every transaction create; couples the write path to an external API; a rate limit becomes a user-facing slow request. Contradicts F4 unless carefully degraded.

**A2. Async via BullMQ (`categorization` queue).**
Transaction is saved immediately with `categoryId: null`; a job is enqueued; a worker calls Claude and updates the row.
*For:* mirrors the `MailQueueService` pattern exactly (retries, backoff, retention caps, non-throwing enqueue); write path stays fast; retry/backoff come free from BullMQ; satisfies F4 by construction.
*Against:* eventual consistency — the client sees `categoryId: null` for a moment and learns the result on the next read.

**A3. Explicit endpoint — `POST /transactions/:id/categorize`.**
User-triggered, synchronous, one transaction.
*For:* smallest possible surface; trivially demoable; no background infrastructure.
*Against:* not automatic; weaker as a product feature.

**A4. Batch sweep — `POST /transactions/categorize-uncategorized`.**
Categorizes everything uncategorized in one pass, optionally through the Message Batches API (50% cost).
*For:* cheapest per transaction; good for backfill.
*Against:* not immediate; batch results arrive out of order and must be keyed by `custom_id`.

**Recommendation: A2**, with A4 available later as a backfill path. A2 reuses the established queue pattern, keeps the write path clean, and builds the BullMQ-plus-LLM plumbing that subsystem B also needs.

### A — Structured output

Use structured outputs (`output_config: {format: {...}}`), not free-text parsing. The schema constrains the response to one of the user's category IDs plus a confidence value:

```
{ categoryId: <enum of this user's category ids> | null, confidence: number }
```

`null` is a deliberate member of the enum: "none of these fit" must be expressible, otherwise the model is forced into a wrong label.

**Two validation layers, and the second is the important one:**

1. **Schema validation** — the response shape. Structured outputs already guarantee this; validating anyway is defense in depth against SDK/API changes.
2. **Ownership validation** — the returned `categoryId` must belong to *this* user. This is authorization, not schema: a model that returns another user's category ID would otherwise write a cross-tenant reference. The check is a repository lookup scoped by `userId`, exactly like `ValidateTransactionOwnershipService` already does elsewhere in the codebase.

A confidence floor (below it, leave `categoryId` null rather than guess) is a cheap quality lever and gives subsystem D something to tune against.

### A — Files touched (sketch)

- `src/shared/llm/` — client, usage accounting, errors (F1/F3)
- `src/modules/transactions/application/categorize-transaction.service.ts`
- `src/shared/llm/categorization-queue.service.ts` + `categorization.processor.ts` + `categorization-job.types.ts` (mirroring `mail-*`)
- No `Transaction` schema change (`categoryId` is already nullable)

---

## Subsystem B — Spending Q&A agent

**What it does:** a natural-language question ("how much did I spend on food last month?") answered by a model that calls tools against the user's own data.

Tools: `query_transactions(filters)`, `compute_totals(groupBy)`, `fetch_categories()`.

### B — The architectural question

The claim under discussion is "each step runs as a BullMQ job with retries, backoff and an idempotency key". That is one of three real shapes, and it is the most expensive one:

**B1. One job per agent *run*; the tool loop runs in-process.**
The whole question becomes a single BullMQ job. Inside the worker, the SDK's tool runner (`client.beta.messages.tool_runner`) drives request → execute → loop until done. Job-level `attempts`/`backoff` give retries; a `max_iterations` cap gives the step limit; an `AgentRun` row with a unique key gives idempotency.
*For:* conventional; far less code; no re-hydration cost; every substantive guarantee (retries, backoff, idempotency, step limit, fallback) still holds.
*Against:* a worker crash mid-run restarts the whole run rather than resuming at the failed step.

**B2. One job per agent *step*, with run state persisted in Postgres.**
`AgentRun` + `AgentStep` models; each step re-hydrates the message history, makes one model call, persists, and chains the next job.
*For:* survives a worker crash mid-run; each step is independently retryable; the run is fully inspectable after the fact.
*Against:* substantially more code and more failure modes; **re-sending the full message history on every step multiplies token cost**; needs careful handling so a retried step does not re-execute a side-effecting tool. For a read-only Q&A that completes in seconds, the resumability buys little.

**B3. Synchronous streaming endpoint (SSE), no queue.**
*For:* best UX by a wide margin — tokens appear as they are generated; simplest infrastructure.
*Against:* no queue story; long-held HTTP connections; retries become the client's problem.

**Recommendation: B1.** B2 is defensible engineering but hard to justify under questioning for a read-only, seconds-long workload — the token cost of re-hydration is a real downside with no matching benefit here. B1 delivers the same guarantees at a fraction of the surface area. If the per-step shape is wanted specifically, B2 is the option, with eyes open about the token multiplication.

### B — Tool design (applies to B1 and B2 alike)

**The user scope must not be a model-supplied parameter.** `userId` comes from the job data, which came from the authenticated request. The tool schemas expose filters (date range, category, type, amount bounds) and nothing that identifies a user. A model that could pass `userId` could read another tenant's data on a hallucination — this is the single most important security property of the subsystem, and it is a design-time decision, not a runtime check.

Tool results are read-only queries, which is what makes retry safe: re-running `query_transactions` has no side effect.

**Failure handling per the API contract:** a failed tool returns a `tool_result` block with `is_error: true` — it is never dropped, because dropping it leaves the conversation malformed. After N consecutive tool failures, the run short-circuits to a fallback answer ("I couldn't read your transactions just now") rather than looping.

**Parallel tool calls:** one assistant message may contain several `tool_use` blocks. All corresponding `tool_result` blocks must be returned in a **single** user message — splitting them across messages silently trains the model out of parallel calls.

### B — Idempotency

Mirror `ProcessedStripeEvent`: an `AgentRun` table with a `@unique` key (client-supplied `Idempotency-Key` header, or derived from `userId` + question + time bucket). Register-first; the second attempt finds the existing row and returns the stored answer instead of re-running.

---

## Subsystem C — RAG over financial education material

**Corpus decided:** Brazilian Central Bank (BCB) financial education material, downloaded as PDFs. Public-domain government educational content — no licensing ambiguity, no scraper, real structure and real mess. A few hundred chunks.

This was chosen over the two alternatives deliberately:
- *API documentation only* (~20 chunks) would fit entirely in a context window, making retrieval decorative rather than necessary.
- *Hand-written help articles* is writing work, not engineering work, and a corpus invented to justify its own retrieval system.

### C1 — Embedding provider

**Anthropic has no embedding endpoint.** This is a hard fact that shapes the subsystem: embeddings come from somewhere else.

- **C1a — Local, `transformers.js` with a multilingual MiniLM.** Runs in-process; no API key; no per-call cost; deterministic.
  *For:* **retrieval eval runs in CI with no secret and no spend** — this decouples subsystem D's retrieval half from the secret problem entirely. Also keeps the project to one vendor.
  *Against:* lower embedding quality than hosted models; slower; adds weight to `node_modules`.
- **C1b — Voyage AI** (Anthropic's recommended embedding partner, multilingual models). Separate key, separate billing.
- **C1c — OpenAI `text-embedding-3-small`.** Cheap, strong Portuguese. Separate key, separate billing, second vendor in the stack.

**Recommendation: C1a to start.** Beyond the CI benefit, it turns the main weakness into the subsystem's best story: with the retrieval eval in place (D), swapping local → hosted becomes a *measured* experiment with a recall@k delta, rather than an assertion. "I benchmarked local against hosted embeddings on a labeled query set" is a stronger thing to have done than "I used the good one".

The embedding provider should sit behind an interface from day one so the swap is a one-line binding change — the same abstract-class-as-DI-token pattern used for repositories.

### C2 — Vector storage

- **C2a — pgvector on the existing Postgres.** One database, transactional with the rest of the data, one less service in `docker-compose.yml`.
  *Known friction:* **Prisma has no native `vector` type.** The column is declared `Unsupported("vector(N)")` and similarity search runs through `$queryRaw`. This is a real ergonomic cost and should be expected, not discovered.
- **C2b — Dedicated vector DB (Qdrant or Weaviate) in `docker-compose.yml`.** Better ergonomics and filtering; an eighth service to run, health-check, and explain.

**Recommendation: C2a.** The Prisma friction is a known, bounded cost — a handful of raw queries behind a repository interface. It keeps the stack at one datastore and is the honest answer to "do you have vector database experience".

Index: `hnsw` for query speed over `ivfflat` at this corpus size; both are a one-line migration difference and the eval can measure the recall trade-off.

### C3 — Chunking

- Fixed-size windows with overlap — simplest, splits mid-sentence.
- Paragraph-boundary with overlap — respects the document's own structure.
- Heading-aware (section as the unit, split when oversized) — best coherence, most parsing work, depends on the PDFs having extractable structure.

**Recommendation: paragraph-boundary with overlap**, and let the eval decide whether heading-aware is worth the parsing. This is precisely the kind of question a retrieval eval exists to answer, so it should not be settled by argument.

### C4 — Answer shape

Retrieved chunks are passed as context with **source references** (document title + page), and the answer cites them. Two mechanics:

- **C4a — manual**: chunks in the prompt, the model instructed to cite, citation correctness unverified.
- **C4b — Citations API**: pass retrieved text as `document` content blocks with `citations: {enabled: true}`; the response splits into text blocks carrying a `citations` array with exact `cited_text` and location. Citations become structurally verifiable rather than a promise in a prompt.

**Recommendation: C4b.** Note one incompatibility: citations and `output_config.format` cannot be combined — a cited answer cannot also be a constrained JSON object. That is fine here (the Q&A answer is prose) but rules out a single call that is both cited and strictly structured.

---

## Subsystem D — Eval pipeline

Three distinct things get evaluated, and they have different costs and different determinism:

| What | Method | Deterministic? | Needs API key? |
|---|---|---|---|
| Categorization | Exact match against a labeled golden set | No (model call) | Yes |
| Retrieval (C) | recall@k, MRR, hit rate against labeled queries | **Yes**, with local embeddings (C1a) | **No** |
| Q&A / RAG answers | LLM-as-judge against a rubric | No (two model calls) | Yes |

### The CI secret problem

This is the real constraint, and it is specific to this repo:

1. `env.ts` throws at import if any variable is missing, and CI writes a `.env.test` of all-fake values. Adding `ANTHROPIC_API_KEY` means adding it to that block — with a fake value, which no real call can use.
2. Real LLM calls on every push cost money that scales with commit frequency.
3. Model output is nondeterministic. A threshold that fails on normal variance produces red builds that are not regressions — and a build that cries wolf gets ignored, which is worse than no eval.

Options:

**D1. A separate workflow (`evals.yml`) on `workflow_dispatch` + a nightly `schedule`.**
Real `ANTHROPIC_API_KEY` from GitHub secrets, used only here. Main CI stays fast, free, and deterministic.
*For:* cost scales with time, not commit rate; variance is observed nightly instead of blocking a merge.
*Against:* a regression is caught on the next run, not at the PR that caused it.

**D2. Real-call evals on every PR.**
*For:* immediate feedback at the point of change.
*Against:* cost scales with commits; flakiness blocks merges; the secret is exposed to every PR workflow, including from forks.

**D3. Recorded fixtures (VCR-style) in the main CI.**
Real responses recorded once, replayed in CI.
*For:* deterministic, free, no secret; genuinely tests the code path — schema validation, ownership check, retry logic, queue wiring.
*Against:* cannot detect model drift, which is the entire reason evals exist.

**Recommendation: D3 for main CI + D1 for real evals.** These answer different questions and neither substitutes for the other. Fixtures in the main pipeline prove the *plumbing* is correct on every push, with no key and no spend. The nightly/dispatch workflow proves the *quality* has not drifted, gated on thresholds. Retrieval eval (deterministic, keyless with C1a) runs in the main CI alongside the fixtures.

### Thresholds

**Gate on regression against a stored baseline, not on an absolute floor.** A baseline file in the repo, updated deliberately when quality legitimately moves. An absolute threshold set close to current performance will fail on variance; one set far from it never fires.

For the judge specifically: a fixed rubric, a low `effort` setting for consistency, and reported variance across runs. LLM-as-judge is noisy and biased toward verbosity — the eval should surface that rather than hide it.

### Golden set sizing

Start at ~50 categorization cases and ~20 Q&A cases. Large enough that a single flip does not move the mean much, small enough to hand-label honestly and to run for cents. The labeled retrieval query set can be larger since it costs nothing to run.

The number matters less than being able to say exactly where the labels came from.

---

## Cross-cutting decisions

| Decision | Options | Note |
|---|---|---|
| New env vars | `ANTHROPIC_API_KEY`, plus an embedding key if C1b/C1c | **Each one must also go into the CI `.env.test` block** or CI breaks at import |
| Secret scope | Eval workflow only vs. all workflows | Keep it out of PR-triggered workflows; fork PRs cannot be trusted with it |
| Cost ceiling | Prometheus counter + alert vs. hard in-code monthly cap | The counter from F3c makes a Grafana alert nearly free |
| Rate limits | SDK default `maxRetries: 2` vs. explicit backoff | BullMQ job-level retry already covers the async paths (A2, B1) |
| Prompt caching | Not worth it initially | The minimum cacheable prefix is ~1024 tokens; the categorization prompt is well under it. Revisit for C, where retrieved context is large |

## Suggested sequencing

If more than one subsystem is built, this order minimizes rework:

1. **A** — smallest; establishes `shared/llm/`, usage accounting, the queue pattern, and the fixture approach.
2. **D (partial)** — the categorization golden set and the fixture harness, both reusable by everything after.
3. **C** — self-contained; the retrieval eval slots into the D harness.
4. **B** — largest; benefits from every piece above already existing.

Each step is independently shippable and independently demoable. Stopping after A+D leaves a coherent, finished feature rather than four half-built ones.

## Explicitly out of scope

- Streaming responses to the client (SSE) — a UX concern, orthogonal to all four
- Per-user LLM quota or rate limiting — needs F3b, and no demand for it yet
- Fine-tuning or few-shot example selection — structured outputs plus a good prompt is the right starting point
- Multi-turn Q&A sessions — single question, single answer; conversation history is a separate design
- Hosting the corpus anywhere but the repo — a few PDFs committed or fetched at build time, not a CMS

## Decisions needed

| ID | Decision | Options | Recommendation |
|---|---|---|---|
| F2 | Model per feature | Opus 5.5 / Sonnet 5.5 / Haiku 5.5 | **A decided: Haiku 5.5.** B/C/D decided in their specs |
| F3 | Usage accounting | log only / DB table / log + Prometheus | **F3c** |
| A | Categorization trigger | sync / queue / explicit endpoint / batch | **A2, decided** → `2026-10-16-ai-categorization-design.md` |
| B | Agent execution shape | run-as-job / step-as-job / sync SSE | **B1** |
| C1 | Embedding provider | local / Voyage / OpenAI | **C1a** |
| C2 | Vector storage | pgvector / dedicated DB | **C2a** |
| C3 | Chunking strategy | fixed / paragraph / heading-aware | **paragraph**, then measure |
| C4 | Citation mechanism | manual / Citations API | **C4b** |
| D | Eval execution | separate workflow / every PR / fixtures | **D3 + D1** |
| — | Scope | which of A/B/C/D get built at all | **All four, in order A → D → C → B.** A+D is the minimum coherent stopping point |
