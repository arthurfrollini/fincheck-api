# Swagger + Scalar API Reference — Design

**Status:** Approved by user, ready for implementation planning.

## Goal

Give the Fincheck API a rich, interactive API reference that documents every route,
DTO, and status code — usable by the frontend, future collaborators, or the user
themselves, without leaving the codebase. This is a standalone sub-project, done
before the error-handling remediation work (audited separately, see
`docs/superpowers/specs/` for that follow-up once this ships).

## Why now

- Zero API documentation exists today (`grep` for swagger/scalar/`@ApiProperty`
  across `src/` returns nothing).
- DTOs are already well-annotated with `class-validator` — the shape information
  needed to generate rich schemas already exists, just not exposed.
- The upcoming error-handling work will touch many of the same controllers; having
  a live reference makes that work easier to verify (can hit `/reference`'s "Try it"
  panel instead of hand-writing curl/Postman requests).

## Packages

- `@nestjs/swagger` — generates the OpenAPI 3 document from existing decorators
  (`@ApiProperty`, `@ApiOperation`, etc.) plus NestJS's own route metadata.
- `@scalar/nestjs-api-reference` — renders that OpenAPI document as an interactive
  reference UI. This is the **only** UI mounted — no `swagger-ui-express` alongside
  it. One reference, one URL.

## Setup

In `main.ts`, after `ValidationPipe`/CORS are configured and before `app.listen()`:

1. Build a `DocumentBuilder` config: title ("Fincheck API"), description (short,
   one-liner matching the README's opening sentence), version (read from
   `package.json`), and a bearer auth scheme (`addBearerAuth()`) — this is what
   lets Scalar's UI carry a JWT when "trying" an authenticated route.
2. `SwaggerModule.createDocument(app, config)` produces the OpenAPI document object.
3. Mount Scalar's NestJS middleware/handler at `/reference`, pointed at that
   document. No separate JSON route is required for Scalar itself, but keep the
   raw OpenAPI JSON reachable too (Scalar's package typically exposes this itself,
   or `SwaggerModule.setup` can serve it at e.g. `/reference-json` if the package
   needs a URL rather than an inline document — confirm exact wiring against
   `@scalar/nestjs-api-reference`'s current README during implementation, since API
   shape can change between versions).
4. Mounted unconditionally — same behavior in every environment (dev, test, prod).
   No `NODE_ENV` branching.

## Annotation scope (rich, not minimal)

Every DTO across all 6 modules gets `@ApiProperty()` next to its existing
`class-validator` decorators — with a `description` and an `example` value where
one is genuinely illustrative (not for every trivial field — e.g. a `name: string`
doesn't need much beyond a description, but `color: string` benefits from
`example: '#7c3aed'`).

DTOs affected: `sign-up`, `sign-in`, `refresh-token` (auth) · `create-user`,
`update-user`, `update-me`, `request-email-change` (users) · `create-bank-account`,
`update-bank-account` · `create-category`, `update-category` ·
`create-transaction`, `update-transaction`.

**Billing needs new DTOs.** `POST /billing/subscribe` and `POST /billing/change-plan`
currently read `@Body('planId') planId: string` directly and validate it manually
inside the controller (`billing.controller.ts:42,51`) — there's no class for
Swagger to introspect, so these two routes would otherwise show up in the reference
with an untyped body. Create `SubscribeDto`/`ChangePlanDto` (or one shared
`{ planId: 'GOLD' | 'PLATINUM' | 'FREE' }` DTO reused with a narrower `@IsIn`
per route if the allowed values differ) using `@IsIn([...])` + `@ApiProperty`,
and switch the controller to consume it via `@Body() dto: ...` like every other
module already does. This is in scope because it's required to document these
routes properly, not unrelated cleanup — and it's a net improvement (declarative
validation via `ValidationPipe` instead of manual `if` checks in the controller).

Every controller method gets:
- `@ApiOperation({ summary })` — one line, plain description of what the route does
- `@ApiResponse({ status, description })` for every status code the route actually
  returns today — reuse the route/status table already recorded in
  `docs/superpowers/plans/2026-07-14-e2e-tests.md`'s "Verified HTTP routes and
  status codes" section as the source of truth, don't re-derive it
- `@ApiTags('<module-name>')` once per controller class

`@ApiBearerAuth()` applied at the controller level for every controller except
`AuthController` (whose routes are `@isPublic()`) and the two public routes inside
`UsersController` (`GET /users/confirm-email`) and `BillingController`
(`POST /billing/webhook`) — check each controller's existing `@isPublic()` usage
before applying, don't assume.

## Testing

No existing e2e assertion touches documentation, and none needs to for correctness
of the API itself — but a broken `/reference` route would go unnoticed by the rest
of the suite. Add one lightweight smoke test (new file or a small addition to an
existing e2e spec, implementer's call) asserting:
- `GET /reference` → 200
- The underlying OpenAPI JSON endpoint (path TBD by the actual package wiring)
  parses as valid JSON and contains at least the `openapi` version field

This is a smoke test, not documentation-content coverage — it exists to catch
"the reference route 500s" class of regression, not to verify every `@ApiProperty`
description is present.

## Out of scope (explicitly, to prevent scope creep during implementation)

- No changes to actual route behavior, status codes, or validation rules beyond
  the two new billing DTOs described above (which replace manual validation with
  equivalent declarative validation — not a behavior change).
- No auth/gating on who can view `/reference` (approved: available in all
  environments).
- No visual/branding customization of the Scalar UI beyond the title Fincheck API
  passed into `DocumentBuilder`.
- Error-handling remediation (global exception filter, Prisma/Stripe error
  translation, webhook idempotency, logging/observability) is a separate,
  already-audited follow-up project — not part of this spec.
