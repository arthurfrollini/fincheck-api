# Known issue: BullMQ/Redis teardown race in the e2e suite

## Symptom

Running `npm run test:e2e` standalone occasionally exits non-zero (or warns
"Jest did not exit") with:

```
Error: Unhandled error. ([Error: Connection is closed.])
    at RedisConnection.emit (node:events:513:17)
    at node_modules/bullmq/dist/cjs/classes/redis-connection.js
```

This happens **after** `Ran all test suites.` — every test assertion has
already passed. It is teardown noise, not a test failure.

## Root cause

Each of the 8 e2e spec files boots its own NestJS app — and therefore its own
BullMQ `Queue` + `Worker` — against the same shared Redis instance, all inside
a single Jest process (`maxWorkers: 1`). Closing these sequentially can leave
a BullMQ-internal Redis connection emitting an `'error'` event after its
owning app has already closed. BullMQ's `RedisConnection` surfaces
connection-init failures via `this.initializing.catch(err => this.emit('error', err))`;
when that `emit` finds no listener, Node's EventEmitter throws, crashing the
process during Jest teardown.

Listeners are attached to every connection the public API exposes
(`Worker` via `@OnWorkerEvent('error')` in `MailProcessor`, `Queue` via
`.on('error')` in `MailQueueService`, per-call `QueueEvents` in
`test/helpers/queue-helper.ts`) — the stray emission comes from an internal
connection BullMQ does not expose, so it cannot be listened to directly.
Process-level `uncaughtException`/`unhandledRejection` guards were tried and
did not reliably intercept it either.

## Resolution in place

Instead of preventing the crash, `scripts/test-combined.sh` (what `npm test`
and the pre-push hook actually gate on) determines real pass/fail from Jest's
own result summary: a minimal custom reporter (`test/e2e-results-reporter.js`)
writes `numFailedTests`/`numFailedTestSuites` to a file synchronously in
`onRunComplete` — before the teardown crash can occur — and the script trusts
that file, not the raw process exit code.

Fail-safe properties (verified with a deliberately broken assertion):

- Any genuine test failure → non-zero exit, full output printed.
- Missing/empty results file (Jest died before finishing) → treated as
  failure, never as a pass.
- Only tolerated case: non-zero raw exit code **with** a written all-pass
  summary — exactly the one documented race above.

## Impact on developers

- `npm test` (and pre-push): unaffected, correct pass/fail always.
- `npm run test:e2e` standalone: may occasionally print the crash and exit 1
  even though every test passed. Informational only — check the test summary
  lines above the crash.

## Possible future proper fix (tech debt)

Isolate each spec file's BullMQ keyspace (per-file Redis DB index or a queue
prefix derived from the spec file) so concurrently-lived app instances never
share queue state, or restructure the e2e suite to boot one app for all spec
files. Either removes the need for the result-gate workaround.
