# Spending Q&A Agent — Design Spec

**Subsystem B of the AI features RFC** (`2026-10-16-ai-features-rfc.md`, option B1). It is the last of the four and reuses `src/shared/llm/` (A), the BullMQ house pattern (A), and `evals/` (D, C).

## Problem

Users want answers about their own money in plain language ("quanto gastei com comida em setembro?", "qual foi meu maior gasto do mês?"). That takes several steps: find the right category, filter transactions by period, sum or group them. The model should plan those steps itself and read the user's data only through narrow, read-only tools that cannot reach another user's data.

## Decisions

1. **Shape: B1, one BullMQ job per agent run.** The tool loop runs in-process inside the worker. One job per step (B2) was rejected: it re-sends the whole conversation on every step, which multiplies token cost for a read-only workload that finishes in seconds.
2. **Model: `claude-sonnet-5-5`** (owner's choice) with `effort: 'medium'`, the recommended starting level for multi-step tool use on this model. **Eval judge: `claude-opus-5-5`.**
3. **Async API:**
   - `POST /assistant/questions` with `{ question }` (1–500 chars) and an optional `Idempotency-Key` header returns **202** `{ runId, status }`.
   - `GET /assistant/runs/:runId` returns `{ status, answer, steps }`, scoped to the authenticated user; another user's run gives 404.
4. **Idempotency:** an `AgentRun` row with `@@unique([userId, idempotencyKey])`, the same register-first pattern as `ProcessedStripeEvent`.
   - A repeated `POST` with the same key returns the existing run (200, not 202) and enqueues nothing.
   - Without a header, every POST is a new run.
   - The BullMQ `jobId` is `agent-run-<runId>`, so a double enqueue is a no-op.
5. **Tools take no user identifier.** The three tool schemas expose only filters. The worker builds the tool handlers in a closure over the run's `userId`, which came from the authenticated request. A model that hallucinates an id has nowhere to put it. All tools are **read-only**, which is why a retried run can never repeat a side effect.
6. **Manual tool loop, not the SDK tool runner.** Each model call goes through `LlmService.complete('agent', ...)`, so every step's tokens and cost land in the same Prometheus counters and logs as A and C. Owning the loop also makes the step limit and the consecutive-failure rule explicit, testable code.
7. **Limits and degradation:**
   - **Step limit:** at most **6 model calls** per run. If the limit is hit, the run ends `degraded` with a fixed answer ("Não consegui concluir a análise...").
   - **Tool failure:** a failed tool returns a `tool_result` with `is_error: true`; it is never dropped. **Two consecutive rounds where every tool call failed** end the run `degraded` with a fixed answer ("Não consegui ler suas transações agora..."). The loop does not keep spending tokens on a broken tool.
   - **Model refusal:** `degraded`, with a fixed answer.
8. **Retries:** model API errors (429, 5xx, network) fail the job, and BullMQ retries it: `attempts: 3`, exponential backoff from 2 s.
   - A retry restarts the run from the question. This is accepted with B1: the tools are read-only and the run is seconds long.
   - Permanent errors (4xx except 408/409/429, or status-less SDK errors) use `UnrecoverableError`, the same classification as A.
   - When the job finally fails, an `@OnWorkerEvent('failed')` handler marks the run `failed` with a fixed answer, so a client polling it never waits forever.
9. **Server-side refusal fallback: off.** Production Sonnet code normally opts into the API's `fallbacks: "default"`, which re-runs a refused request on another model. It is left off for now:
   - It needs the beta messages endpoint, which `LlmService` does not use.
   - In a multi-turn tool loop, a mid-run model switch drops the thinking blocks the other model cannot read.
   - Refusals on "how much did I spend on food" are expected to be rare. They degrade gracefully and are counted (`outcome=refusal`), so the metric shows whether the fallback is ever worth adding.

## Tools

All tools set `strict: true`. All dates are ISO `YYYY-MM-DD`; ranges are inclusive and at most 366 days. Values are BRL.

| Tool | Input | Returns |
|---|---|---|
| `fetch_categories` | `{}` | `[{ id, name, type }]` — the user's categories |
| `query_transactions` | `{ from, to, type?, categoryId?, minValue?, maxValue?, limit? (1–50, default 20), orderBy? ('date' \| 'value', default 'date' desc) }` | `{ transactions: [{ id, name, value, date, type, categoryName }], total, truncated }` |
| `compute_totals` | `{ from, to, type?, categoryId?, groupBy: 'none' \| 'category' \| 'month' }` | `{ groups: [{ key, label, total, count }], grandTotal }` |

- Tool inputs are validated with zod before running. An invalid input becomes an `is_error` tool result, not an exception.
- A `categoryId` that is not the user's simply matches nothing, because every query filters by the closure's `userId` first.
- New read methods go on the existing repositories:
  - `TransactionsRepository.search(userId, filters)`, which uses Prisma `findMany` + `count`;
  - `TransactionsRepository.totals(userId, filters, groupBy)`, which uses Prisma `groupBy` / `aggregate`, with month grouping done in application code over a `date`/`value` projection (the volume is small).
- `TransactionsModule` exports `TransactionsRepository`.
- **Parallel tool calls:** every `tool_use` block in one assistant message is executed concurrently, and **all** their results go back in **one** user message.
- **Conversation is append-only:** each assistant `content` is appended unchanged, thinking blocks included, as Sonnet 5.5 requires. Nothing earlier is edited.

## Architecture

```
src/modules/assistant/
  entities/AgentRun.ts
  domain/repositories/agent-runs.repository.ts       # register(userId, key, question) → {run, created}, find(userId, id), complete/degrade/fail
  application/agent-tools.ts                         # tool definitions (JSON schema + zod) + buildToolHandlers(userId, repos)
  application/run-agent.service.ts                   # the loop: steps, tool execution, degradation; pure w.r.t. Nest besides DI
  application/agent.constants.ts                     # model, MAX_STEPS, system prompt, fixed answers
  infra/database/agent-runs.prisma.repository.ts
  infra/queue/{agent-job.types,agent-queue.service,agent.processor}.ts
  infra/http/{assistant.controller,dto/ask-assistant.dto}.ts
  assistant.module.ts
```

- **Prisma `AgentRun`:** `id`, `userId` (FK, cascade), `idempotencyKey String?`, `question`, `status` enum (`QUEUED | RUNNING | COMPLETED | DEGRADED | FAILED`), `answer String?`, `steps Int @default(0)`, `createdAt`, `completedAt?`, `@@unique([userId, idempotencyKey])`.
- **Metrics:** `LlmFeature` += `'agent'`. New counter `fincheck_agent_runs{status}` and histogram-free counter `fincheck_agent_steps_total`.
- **System prompt:** today's date (so "mês passado" resolves); answer in Brazilian Portuguese; use the tools for every number and never invent one; say when the data doesn't cover the question. User data stays out of the system prompt.
- **Log hygiene:** never log the question, tool inputs or tool results (user financial data). Log run id, step count, tool names and outcome.

## Failure matrix

| Case | Behavior |
|---|---|
| Same `Idempotency-Key` twice | Second POST returns the first run, 200, no new job |
| Redis down at enqueue | Run stays `QUEUED`; error logged; POST still returns 202. Accepted: same posture as A. A stale-run sweep is out of scope. |
| Tool throws (DB error) | `is_error` result; the model may retry with other inputs; 2 all-failed rounds in a row → `DEGRADED` |
| Tool input fails validation | `is_error` result explaining the problem; counts as a failed call |
| 6 model calls without a final answer | `DEGRADED` (step limit) |
| Refusal | `DEGRADED` |
| 429 / 5xx / network | Job retried (3 attempts); final failure → `FAILED` with a fixed answer |
| 401/403/400 from the API | `UnrecoverableError` → `FAILED` immediately |
| Run polled by another user | 404 |

## Evals

- **Main CI (keyless):** the loop runs against a scripted fake `LlmService`, a recorded sequence of assistant messages with `tool_use` blocks.
  - Tests cover: tools see only the closure's user, a parallel tool round returns its results in one message, the step limit, two all-failed rounds degrade, a refusal degrades, and the thinking blocks are appended unchanged.
  - Tool handlers are tested against a seeded Postgres in e2e.
- **Scheduled (`evals.yml`, job `agent`):**
  - **Setup:** a fixed seed creates one user with about 40 transactions over two months (`evals/agent/seed.ts`).
  - **Cases:** 10 questions with **exact expected numbers** (`evals/agent/cases.jsonl`, e.g. "quanto gastei com Alimentação em setembro de 2026?" → `412,37`).
  - **Grading:**
    - **Deterministic check:** the expected value appears in the answer. BRL formatting is normalized, so `R$ 412,37`, `412.37` and `412,37` all match.
    - **Judge:** `claude-opus-5-5` checks that every number in the answer is supported by the tool results the run actually saw. That catches a right number reached by luck, and an invented extra number.
  - **Pass:** the number matches **and** the judge says grounded.
  - **Gate:** regression versus `evals/baselines/agent.json`, with a 2-case tolerance on 10.
  - **Agent trace:** the run records its tool calls and results (in memory, eval only) so the judge can see them.

## Out of scope

- Multi-turn conversations: one question, one answer.
- Streaming or SSE: the client polls.
- Write tools, such as "recategorize this transaction". They would bring side effects, and with them B2-style per-step idempotency.
- Resuming a run mid-way after a worker crash (B2).
- A stale-run sweeper for runs stuck in `QUEUED` after a Redis outage.
