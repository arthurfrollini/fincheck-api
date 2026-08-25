# Observability Stack (Metrics + Logs, Grafana) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the metrics and logs pillars of observability (traces already done via OpenTelemetry+Jaeger) and unify all three in a single Grafana UI, at minimal cost.

**Architecture:** Reuse the existing `NodeSDK` in `src/tracing.ts` for metrics by adding a `PrometheusExporter` as its `metricReader` — no second metrics library. Add one custom business metric (`fincheck_active_subscriptions`) via the OpenTelemetry Metrics API directly, wired through a NestJS provider so it can use the app's existing `PrismaService`. Ship logs to Loki via a second `pino-loki` transport target, additive to the existing stdout output. Add `prometheus`, `loki`, and `grafana` services to docker-compose; provision Grafana with three datasources (Prometheus, Loki, and the already-running Jaeger) so one Grafana tab covers all three pillars without replacing Jaeger.

**Tech Stack:** NestJS, `@opentelemetry/sdk-node`, `@opentelemetry/exporter-prometheus`, `@opentelemetry/api`, `nestjs-pino`, `pino-loki`, Docker Compose, Prometheus, Grafana, Loki.

## Global Constraints

- No second metrics library — extend the existing `@opentelemetry/sdk-node` setup only (`docs/superpowers/specs/2026-08-25-observability-stack-design.md` Part 1).
- Exactly one new business metric this pass: `fincheck_active_subscriptions`, counting users where `plan` is `GOLD` or `PLATINUM`. No other new metrics (spec's "Explicitly out of scope").
- `pino-loki` is additive — the existing stdout log output must be preserved, not replaced.
- Jaeger stays as the trace backend, wired into Grafana as a datasource — not replaced by Grafana Tempo (spec's "Explicitly out of scope").
- No alerting rules, no containerizing the app itself (spec's "Explicitly out of scope").
- Datasource/scrape config lives in version-controlled files, not manual UI clicks.
- The app process runs on the **host** during dev, not in a container — any docker-compose service that needs to reach it (Prometheus scraping) must target `host.docker.internal`, not a compose service name.

---

## Task 1: Prometheus metric reader on the existing OpenTelemetry SDK

**Files:**
- Modify: `src/tracing.ts`
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Produces: a Prometheus-format scrape endpoint at `http://localhost:9464/metrics`, exposing whatever the existing auto-instrumentation already emits (HTTP/Express/Nest/Prisma request metrics) — no new instrumentation code needed for this part.

- [ ] **Step 1: Install the Prometheus exporter package**

Run: `npm install @opentelemetry/exporter-prometheus@0.221.0`

Pinned to `0.221.0` to match the other `@opentelemetry/*` experimental packages already in `package.json` (`sdk-node`, `exporter-trace-otlp-http` are both `^0.221.0`), confirmed to exist on the registry.

- [ ] **Step 2: Add the metric reader to the SDK**

In `src/tracing.ts`, add the import and the `metricReader` option:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'fincheck-api' }),
  traceExporter: new OTLPTraceExporter({
    url:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
      'http://localhost:4318/v1/traces',
  }),
  metricReader: new PrometheusExporter({ port: 9464 }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
    new PrismaInstrumentation(),
  ],
});
sdk.start();
process.on('SIGTERM', () => {
  sdk.shutdown().finally(() => process.exit(0));
});
```

`PrometheusExporter` implements `MetricReader` itself and starts its own tiny HTTP server on the given port — no separate collector needed.

- [ ] **Step 3: Verify manually**

Run: `npm run start:dev`, wait for boot, then in another terminal:
`curl http://localhost:9464/metrics`

Expected: Prometheus-format text output (lines like `# TYPE ... counter`, `# HELP ...`) including at least one `http_server_*` or `nodejs_*` metric. No test file — `src/tracing.ts` is boot-time infrastructure code with no existing unit test coverage in this repo (confirmed via the coverage report: `tracing.ts` is already at 0% coverage, same as `main.ts`), so this stays consistent with the existing pattern rather than introducing test scaffolding for a file that's really just SDK wiring.

- [ ] **Step 4: Commit**

```bash
git add src/tracing.ts package.json package-lock.json
git commit -m "feat: expose Prometheus metrics via OpenTelemetry SDK"
```

---

## Task 2: Custom business metric — active subscriptions

**Files:**
- Create: `src/shared/billing/billing.metrics.ts`
- Create: `src/shared/billing/billing.metrics.spec.ts`
- Modify: `src/shared/billing/billing.module.ts`
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: `PrismaService` from `@shared/database/prisma.service` (existing class, constructor-injected — see `src/shared/billing/stripe-events.prisma.repository.ts` for the same injection pattern in this module).
- Produces: `BillingMetricsService` class with a public `getActiveSubscriptionsCount(): Promise<number>` method, and an OTel `fincheck_active_subscriptions` observable gauge registered on `onModuleInit`.

- [ ] **Step 1: Install `@opentelemetry/api` as a direct dependency**

Run: `npm install @opentelemetry/api@1.9.1`

It's already present transitively (pulled in by `@opentelemetry/sdk-node`), but `billing.metrics.ts` imports from it directly, so it needs to be a direct `package.json` dependency, not an implicit transitive one.

- [ ] **Step 2: Write the failing test**

Create `src/shared/billing/billing.metrics.spec.ts`:

```typescript
import { BillingMetricsService } from './billing.metrics';
import { PrismaService } from '@shared/database/prisma.service';

describe('BillingMetricsService', () => {
  let mockPrisma: { user: { count: jest.Mock } };
  let service: BillingMetricsService;

  beforeEach(() => {
    mockPrisma = { user: { count: jest.fn().mockResolvedValue(0) } };
    service = new BillingMetricsService(
      mockPrisma as unknown as PrismaService,
    );
  });

  it('counts users on GOLD or PLATINUM plans', async () => {
    mockPrisma.user.count.mockResolvedValueOnce(7);

    await expect(service.getActiveSubscriptionsCount()).resolves.toBe(7);
    expect(mockPrisma.user.count).toHaveBeenCalledWith({
      where: { plan: { in: ['GOLD', 'PLATINUM'] } },
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:unit -- billing.metrics`
Expected: FAIL — `Cannot find module './billing.metrics'`

- [ ] **Step 4: Write the implementation**

Create `src/shared/billing/billing.metrics.ts`:

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { PrismaService } from '@shared/database/prisma.service';

@Injectable()
export class BillingMetricsService implements OnModuleInit {
  constructor(private readonly prismaService: PrismaService) {}

  async getActiveSubscriptionsCount(): Promise<number> {
    return this.prismaService.user.count({
      where: { plan: { in: ['GOLD', 'PLATINUM'] } },
    });
  }

  onModuleInit() {
    const meter = metrics.getMeter('fincheck-api');
    meter
      .createObservableGauge('fincheck_active_subscriptions')
      .addCallback(async (result) => {
        result.observe(await this.getActiveSubscriptionsCount());
      });
  }
}
```

`plan` values `GOLD`/`PLATINUM` come from the `Plan` enum in `prisma/schema.prisma` (also used in `src/shared/plan/plan.constants.ts`) — these are the two paid plans; `FREE` and `ADMINISTRATOR` are excluded.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit -- billing.metrics`
Expected: PASS

- [ ] **Step 6: Register the provider**

In `src/shared/billing/billing.module.ts`, add the import and provider:

```typescript
import { Global, Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingWebhookHandler } from './billing.webhook';
import { BillingController } from './billing.controller';
import { StripeEventsRepository } from './stripe-events.repository';
import { StripeEventsPrismaRepository } from './stripe-events.prisma.repository';
import { StripeEventsCleanupJob } from './stripe-events-cleanup.job';
import { stripeProvider } from './stripe.provider';
import { UsersModule } from '@modules/users/users.module';
import { BillingMetricsService } from './billing.metrics';

@Global()
@Module({
  imports: [UsersModule],
  controllers: [BillingController],
  providers: [
    stripeProvider,
    BillingService,
    BillingWebhookHandler,
    {
      provide: StripeEventsRepository,
      useClass: StripeEventsPrismaRepository,
    },
    StripeEventsCleanupJob,
    BillingMetricsService,
  ],
  exports: [BillingService],
})
export class BillingModule {}
```

- [ ] **Step 7: Verify manually end-to-end**

Run: `npm run start:dev`, wait for boot, then:
`curl -s http://localhost:9464/metrics | grep fincheck_active_subscriptions`

Expected: a line like `fincheck_active_subscriptions{...} <N>` where `<N>` matches the real count of GOLD/PLATINUM users in the dev database.

- [ ] **Step 8: Commit**

```bash
git add src/shared/billing/billing.metrics.ts src/shared/billing/billing.metrics.spec.ts src/shared/billing/billing.module.ts package.json package-lock.json
git commit -m "feat: add fincheck_active_subscriptions business metric"
```

---

## Task 3: Prometheus service in docker-compose

**Files:**
- Create: `docker/prometheus/prometheus.yml`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: the `:9464/metrics` endpoint from Task 1, reachable from inside the Prometheus container as `host.docker.internal:9464` (the app runs on the host, not in a compose service — see Global Constraints).

- [ ] **Step 1: Write the scrape config**

Create `docker/prometheus/prometheus.yml`:

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: fincheck-api
    # The app runs on the host during dev, not as a compose service — from
    # inside this container "localhost" means the container itself, so the
    # target must be host.docker.internal (works out of the box on Docker
    # Desktop for Mac/Windows; on Linux it needs an extra_hosts entry).
    static_configs:
      - targets: ['host.docker.internal:9464']
```

- [ ] **Step 2: Add the service to docker-compose.yml**

In `docker-compose.yml`, add after the `jaeger` service:

```yaml
  prometheus:
    image: prom/prometheus:v3.14.0
    container_name: prometheus
    restart: unless-stopped
    volumes:
      - ./docker/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    ports:
      - '9090:9090'
```

And add `prometheus_data:` to the top-level `volumes:` block.

- [ ] **Step 3: Verify manually**

Run: `npm run start:dev` (if not already running), then `docker compose up -d prometheus`.

Open `http://localhost:9090/targets` — expected: target `fincheck-api` with state `UP`.

If it shows `DOWN` with a connection-refused error, confirm the app is actually running and listening on `:9464` (Task 1, Step 3) before debugging the container networking.

- [ ] **Step 4: Commit**

```bash
git add docker/prometheus/prometheus.yml docker-compose.yml
git commit -m "infra: add Prometheus, scraping the app's metrics endpoint"
```

---

## Task 4: Loki service + pino-loki log shipping

**Files:**
- Create: `docker/loki/loki-config.yaml`
- Modify: `docker-compose.yml`
- Modify: `src/app.module.ts`
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Produces: every log line the app already emits via `nestjs-pino`, additionally pushed to Loki's HTTP push API at `http://localhost:3100/loki/api/v1/push`, labeled `app=fincheck-api`.

- [ ] **Step 1: Write the Loki config**

Create `docker/loki/loki-config.yaml` (single-binary, filesystem storage — no object storage needed at this scale):

```yaml
auth_enabled: false

server:
  http_listen_port: 3100

common:
  ring:
    instance_addr: 127.0.0.1
    kvstore:
      store: inmemory
  replication_factor: 1
  path_prefix: /loki

schema_config:
  configs:
    - from: 2024-01-01
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h

storage_config:
  filesystem:
    directory: /loki/chunks
```

- [ ] **Step 2: Add the service to docker-compose.yml**

In `docker-compose.yml`, add after `prometheus`:

```yaml
  loki:
    image: grafana/loki:3.7.6
    container_name: loki
    restart: unless-stopped
    command: ['-config.file=/etc/loki/loki-config.yaml']
    volumes:
      - ./docker/loki/loki-config.yaml:/etc/loki/loki-config.yaml
      - loki_data:/loki
    ports:
      - '3100:3100'
```

And add `loki_data:` to the top-level `volumes:` block.

- [ ] **Step 3: Install pino-loki**

Run: `npm install pino-loki@3.0.0`

- [ ] **Step 4: Wire the transport**

In `src/app.module.ts`, replace `LoggerModule.forRoot()` with:

```typescript
LoggerModule.forRoot({
  pinoHttp: {
    transport: {
      targets: [
        // Preserves the existing default behavior: raw JSON to stdout.
        { target: 'pino/file', options: { destination: 1 } },
        {
          target: 'pino-loki',
          options: {
            host: process.env.LOKI_URL ?? 'http://localhost:3100',
            labels: { app: 'fincheck-api' },
          },
        },
      ],
    },
  },
}),
```

`LoggerModule.forRoot()` currently takes no arguments (bare default), so there is no existing `pino-pretty`/stdout transport config to preserve beyond this — `pino/file` with `destination: 1` (stdout's file descriptor) replicates the current default JSON-to-stdout behavior explicitly, since specifying any `transport.targets` array replaces pino's implicit default destination.

- [ ] **Step 5: Verify manually**

Run: `docker compose up -d loki`, then `npm run start:dev`, then trigger any request (e.g. `curl http://localhost:3000/users/me` with a valid token, or any endpoint that logs).

Query Loki directly:
```bash
curl -s -G 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={app="fincheck-api"}' | head -c 500
```

Expected: a JSON response with `"status":"success"` and at least one log entry in `data.result`.

- [ ] **Step 6: Commit**

```bash
git add docker/loki/loki-config.yaml docker-compose.yml src/app.module.ts package.json package-lock.json
git commit -m "feat: ship logs to Loki alongside existing stdout output"
```

---

## Task 5: Grafana with Prometheus/Loki/Jaeger datasources

**Files:**
- Create: `docker/grafana/provisioning/datasources/datasources.yml`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: `prometheus:9090`, `loki:3100`, `jaeger:16686` — all reachable by compose service name since Grafana, unlike Prometheus, only talks to other containers on the same compose network, never to the host app directly.

- [ ] **Step 1: Write the datasource provisioning file**

Create `docker/grafana/provisioning/datasources/datasources.yml`:

```yaml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true

  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100

  - name: Jaeger
    type: jaeger
    access: proxy
    url: http://jaeger:16686
```

- [ ] **Step 2: Add the service to docker-compose.yml**

In `docker-compose.yml`, add after `loki`:

```yaml
  grafana:
    image: grafana/grafana:13.2.0
    container_name: grafana
    restart: unless-stopped
    volumes:
      - ./docker/grafana/provisioning:/etc/grafana/provisioning
      - grafana_data:/var/lib/grafana
    ports:
      - '3001:3000'
```

Host port `3001` (not `3000`) because the Fincheck API itself listens on `3000` — avoids a port clash on the host.

And add `grafana_data:` to the top-level `volumes:` block.

- [ ] **Step 3: Verify manually**

Run: `docker compose up -d grafana`.

Open `http://localhost:3001` (default login `admin`/`admin`, prompts a password change — fine to skip/set anything for local dev). Go to Connections → Data sources — expected: `Prometheus`, `Loki`, and `Jaeger` all listed, each showing a successful "Test" (or query them directly: Explore → pick each datasource → run a basic query and confirm data returns for each of the three, using the same signup/login flow from earlier tracing verification to generate fresh spans/logs/metrics if needed).

- [ ] **Step 4: Commit**

```bash
git add docker/grafana/provisioning docker-compose.yml
git commit -m "infra: add Grafana with Prometheus, Loki, and Jaeger datasources"
```

---

## Task 6: Full-stack verification

**Files:** none (verification only)

- [ ] **Step 1: Bring up the full stack**

Run: `docker compose up -d --force-recreate` (force-recreate avoids the stale-container-config issue hit earlier in this project — see `docker compose ps` afterward to confirm all 7 services are `Up`: `db`, `redis`, `redisinsight`, `jaeger`, `prometheus`, `loki`, `grafana`).

- [ ] **Step 2: Generate real traffic**

Run: `npm run start:dev`, then exercise a real flow (signup, sign-in, `GET /users/me`) — the same requests used to verify tracing originally.

- [ ] **Step 3: Confirm all three pillars in Grafana**

In `http://localhost:3001`:
- Explore → Jaeger → find the trace for the request just made.
- Explore → Loki → `{app="fincheck-api"}` → find the corresponding log lines, confirm `trace_id` field present and matches the trace above.
- Explore → Prometheus → query `fincheck_active_subscriptions` → confirm a numeric value returns.

No commit for this task — it's a manual end-to-end check that the previous 5 tasks compose correctly, not new code.
