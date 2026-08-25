# Observability Stack (Metrics + Logs, unified in Grafana) — Design Spec

**Builds directly on the OpenTelemetry/Jaeger tracing work in `feat/opentelemetry-jaeger-tracing`** (same repo, not yet merged — traces already implemented and verified against real requests, documented in `../../../../Logging-ErrorHandling-Observabilidade.md`, one level above the `api/` project root). This spec closes the remaining two pillars — metrics and logs — and wires all three (traces, metrics, logs) into a single Grafana pane.

**Sequencing decision:** this ships as its **own follow-up branch/PR** once the tracing branch merges, not stacked onto it — the tracing work is already a complete, independently-shippable unit, and this is a distinct enough scope (3 new services, a new custom metric, a log transport change) that bundling them would make one oversized PR harder to review.

## Context / current gaps

- Traces: done (OpenTelemetry SDK → Jaeger v2, verified live).
- Metrics: **nothing exists** — no `/metrics` endpoint, no `prom-client`, no `@nestjs/terminus`. Confirmed via `npm ls` and `grep` before writing this spec.
- Logs: `nestjs-pino` writes structured JSON, but only to stdout — nothing ships it anywhere queryable.
- The app process itself runs on the **host** during dev (`npm run start:dev`), not inside a container — this rules out the classic "sidecar agent tails container log files" pattern for shipping logs (no container log file to tail).

## Part 1 — Metrics (Prometheus)

**Approach:** reuse the existing `NodeSDK` in `src/tracing.ts` rather than introducing a second, separate metrics library. Add a `PrometheusExporter` (`@opentelemetry/exporter-prometheus`) as a `metricReader`. The same auto-instrumentation already generating spans (HTTP, Express, NestJS core, Prisma) also emits basic metrics for those same libraries (request duration histograms, request counts) — this comes essentially for free, no new instrumentation code.

```typescript
// src/tracing.ts (addition)
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

const sdk = new NodeSDK({
  // ...existing resource, traceExporter, instrumentations...
  metricReader: new PrometheusExporter({ port: 9464 }),
});
```

This exposes `http://localhost:9464/metrics` — a pull endpoint Prometheus scrapes on an interval (Prometheus's native model, unlike the push-based OTLP we use for traces).

**Custom metric: active subscriptions.** Arthur wants this tracked as a real business number, not just generic HTTP/DB timing. Implemented as an `ObservableGauge` via the OpenTelemetry Metrics API directly — no second metrics library (`@willsoto/nestjs-prometheus`) needed, keeping a single metrics pathway through the same SDK:

```typescript
// src/shared/billing/billing.metrics.ts (new file)
import { metrics } from '@opentelemetry/api';
import { db } from '@/shared/database/prisma.service'; // adjust import to actual PrismaService injection pattern used elsewhere

const meter = metrics.getMeter('fincheck-api');

meter.createObservableGauge('fincheck_active_subscriptions').addCallback(async (result) => {
  const count = await db.user.count({ where: { plan: { in: ['GOLD', 'PLATINUM'] } } });
  result.observe(count);
});
```

Registered once at startup (imported alongside `tracing.ts`'s bootstrap, or from a NestJS provider's `onModuleInit` — exact wiring point to be decided during implementation, not this spec).

**Out of scope (this pass):** any metric beyond active subscriptions (e.g. daily transaction volume, queue depth) — same "bundle small independent items, document the rest as follow-up" pattern the repo already uses (see `2026-07-16-final-hardening-design.md`).

## Part 2 — Logs (Loki)

**Approach:** `pino-loki` as a second pino transport, shipping the same structured logs already produced to Loki's push API, in addition to (not instead of) the existing stdout output.

```typescript
// wherever the pino logger is configured (LoggerModule.forRoot or equivalent)
transport: {
  targets: [
    { target: 'pino-pretty', options: { /* existing stdout config */ } },
    { target: 'pino-loki', options: { host: process.env.LOKI_URL ?? 'http://localhost:3100' } },
  ],
},
```

This was the only realistic option given the host-process constraint noted above — Promtail-style log-file tailing doesn't apply without containerizing the app itself, which is out of scope here.

## Part 3 — Docker Compose additions

Three new services: `prometheus`, `grafana`, `loki`. Total service count goes from 4 (db, redis, redisinsight, jaeger) to 7. Confirmed acceptable — RedisInsight stays too (unrelated tool, database inspection not observability).

- `prometheus`: scrapes `fincheck-api:9464/metrics` on an interval (config file, mounted like the existing Jaeger config pattern in `docker/jaeger/`).
- `loki`: receives pushed logs from `pino-loki`, in-memory/local filesystem storage for dev (no need for object storage at this scale).
- `grafana`: provisioned with three datasources — Prometheus, Loki, and **Jaeger** (querying the already-running `jaeger` service's query API, not a new backend). This is what gives the "one Grafana tab for everything" outcome Arthur asked for, without replacing Jaeger (that would have required swapping to Grafana Tempo — considered and explicitly rejected earlier in this design conversation, since it would discard the already-verified Jaeger v2 setup for no functional gain at this stage).

Datasource provisioning goes in version-controlled YAML (Grafana's provisioning directory pattern), not manual UI clicks — reproducible or it doesn't count.

## Explicitly out of scope

- Grafana Tempo / replacing Jaeger as the trace backend — real option, deliberately deferred; would double this spec's scope for no clear near-term benefit.
- Jaeger's own "Monitor" tab (Service Performance Monitoring via the `spanmetrics` connector) — technically cheap to add once Prometheus exists (just Collector config, no new container), but not requested; noted here so it isn't rediscovered as a surprise later.
- Any metric beyond active subscriptions (Part 1).
- Alerting rules (Grafana/Prometheus alerting) — visualization only, this pass.
- Containerizing the app itself.

## Testing / verification plan

No existing automated test suite covers infrastructure/observability wiring (same as the tracing work). Verification is manual, live, the same way tracing was validated:
1. `docker compose up -d` — all 7 services healthy.
2. Hit `/metrics` directly, confirm Prometheus-format output including `fincheck_active_subscriptions`.
3. Open Prometheus UI, confirm the scrape target is up.
4. Trigger a real signup (bumps a subscription-adjacent code path indirectly, or manually flip a test user's plan) and confirm the gauge value changes on next scrape.
5. Open Grafana, confirm all three datasources connect, pull a trace via the Jaeger datasource, pull a log line via Loki, pull the metric via Prometheus — all from inside Grafana, no tab-switching to Jaeger's own UI required for that pass.
