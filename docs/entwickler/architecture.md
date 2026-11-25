# Architecture

A map of how Clokr is built, for contributors and self-hosters. To run it, see [Getting started](../getting-started.md) and [Deployment](../deployment.md); for the schema layer, see [Database migrations](../migrations.md). The rules that decide where code may live are in [ADR 0002](../adr/0002-vier-kontexte-und-unterbau.md); read it before adding a feature or moving code across a context boundary.

## Three tiers

```
Browser (SvelteKit app, rendered client-side)
        │  HTTPS (through your reverse proxy)
        ▼
Web container  ──/api proxy──►  API container (Fastify REST)
   (port 3000)                     (port 4000)
                                       │  Prisma
                                       ▼
                                 PostgreSQL 18
                         (+ MinIO object storage)
```

- **Web** — a SvelteKit app with Svelte 5 runes, rendered in the browser. It fetches all data from the API. The web server (`apps/web/src/hooks.server.ts`) forwards `/api` requests to the API container, sets the Content-Security-Policy headers and writes structured logs.
- **API** — a Fastify 5 service that owns every business rule: validation (Zod), authentication, permissions, data access and scheduled jobs.
- **Database** — PostgreSQL 18, accessed only through Prisma 7.
- **Object storage** — MinIO (S3-compatible) for avatars and absence documents.
- **Redis** is part of the compose files and `REDIS_URL` is a config key, but no API code uses it today. Nothing in Clokr depends on Redis being reachable.

## Monorepo layout

Clokr is a pnpm workspace:

| Path                    | What it is                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`              | Fastify backend: routes, plugins, middleware, scheduled jobs, tests                                                                         |
| `apps/web`              | SvelteKit frontend: pages, components, stores, API client                                                                                   |
| `apps/e2e`              | Playwright end-to-end tests                                                                                                                 |
| `apps/fritzbox-adapter` | A small service in the salon LAN that reads WLAN presence from a FRITZ!Box and serves the QR pairing page                                   |
| `apps/sim`              | The simulation instance with seeded bots and a nightly invariant checker, never part of a release image, see [Simulation](../simulation.md) |
| `apps/docs`             | This documentation site (VitePress), see [How this site is built](index.md#how-this-site-is-built)                                          |
| `packages/db`           | Prisma schema, migrations, seeds and the generated client (`@clokr/db`)                                                                     |
| `packages/types`        | Shared TypeScript types (`@clokr/types`)                                                                                                    |
| `packages/mcp`          | An MCP server for querying the API during development (`@clokr/mcp`)                                                                        |

There is no desktop client for NFC terminals any more. A terminal is a device that signs in with a terminal API key and calls the API.

## Contexts inside the API

The API is organised by business context, not by technical layer (ADR 0002). Under `apps/api/src`:

| Directory                                     | Role                                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contexts/time-tracking` and `services/clock` | **Zeiterfassung**: clock in and out, corrections, validity, ArbZG checks. Records what happened.                                                 |
| `contexts/absence`                            | **Abwesenheiten**: requests, approval, entitlement, carry-over. A workflow with status.                                                          |
| `contexts/scheduling` and `services/phorest`  | **Schichtplanung**: shifts, templates, coverage, availability, the Phorest sync.                                                                 |
| `contexts/working-time-account`               | **Arbeitszeitkonto**: Soll against Ist, saldo, Monatsabschluss. It reads from the others and owns the rule that a day reduces Soll exactly once. |
| `contexts/platform`                           | The shared substrate (**Unterbau**) that belongs to no context: tenants, employees, users, salons, permissions and the audit.                    |
| `composition`                                 | The composition layer: dashboards, reports and PDF export that read several contexts. It owns no model and carries no business rule.             |

The rules that follow from this, in short:

- A context is entered only through its `index.ts`. A lint rule (`eslint.boundaries.mjs`) fails the build on a deep import into another context.
- There are no foreign keys between peer contexts. Foreign keys onto the substrate are allowed.
- Absence is never a time-entry type, and `calcLeaveAbsenceMinutesTz()` is not split.
- Tactical building blocks (aggregate, repository, value object) exist only in `working-time-account`.

The decision, the exceptions and the deviations from the target picture are in [ADR 0002](../adr/0002-vier-kontexte-und-unterbau.md), [ADR 0001](../adr/0001-drei-kontexte.md) (partly superseded) and [the list of deviations](../adr/0001-abweichungen.md). A map of the code against the cut is [the context cut map](../context-cut-map.md).

## API composition: the plugin pattern

`apps/api/src/app.ts` builds the Fastify instance (`buildApp()`) and is used by `index.ts` and by the tests. It registers plugins that decorate the instance with cross-cutting services via `fastify-plugin`, then registers the route modules under `/api/v1/...`.

| Plugin                          | Responsibility                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `prisma`                        | The database client, available as `app.prisma`                                                             |
| `audit`                         | `app.audit()`: writes an `AuditLog` entry with user, action, entity, old and new values, IP and user agent |
| `mailer`                        | SMTP e-mail (invitations, notifications)                                                                   |
| `notify`                        | In-app notifications and, when configured, web push                                                        |
| `storage`                       | MinIO or S3 file storage                                                                                   |
| `scheduler` and the job plugins | Scheduled work, see below                                                                                  |

A route module exports one `async function xxxRoutes(app)`. It validates input with Zod schemas defined at the top of the file and states the permission it needs. Authentication is `requireAuth` in `middleware/auth.ts` (a JWT, or an API key with the `clk_` prefix, or a terminal key). Authorization is by permission (`requirePermission`, `hasPermission`), never by role name. The catalog is in [Permissions](../permissions.md).

## Scheduled jobs

Jobs run inside the API process with `node-cron`. There is no external queue. Each job plugin registers its tasks on `onReady`, stops them on `onClose` and loops over all tenants.

| Plugin                                                              | What it does                                                                                                                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `time-tracking/plugins/attendance-checker`                          | Reminders and checks: forgotten clock-outs, automatic invalidation of long-open entries, missing entries, pending requests, upcoming absences, unconfirmed breaks |
| `working-time-account/plugins/auto-close-month`                     | The automatic Monatsabschluss and the reminder for deferred closes                                                                                                |
| `composition/data-retention`                                        | Annual archival of records past the retention period                                                                                                              |
| `scheduling/plugins/scheduler`                                      | The Phorest sync                                                                                                                                                  |
| `absence/plugins/carryover-warning`                                 | Warnings before carried-over leave lapses                                                                                                                         |
| `platform/plugins/token-cleanup`, `school-holidays-sync` and others | Housekeeping                                                                                                                                                      |

## Data conventions

- **Multi-tenancy.** Every employee-scoped row carries a `tenantId`. The JWT carries it, and every query filters by it. Per-tenant settings live in `TenantConfig`.
- **Soft delete.** `TimeEntry`, `LeaveRequest` and `Absence` use `deletedAt`, and every query includes `deletedAt: null`.
- **Immutability after close.** A closed month is never edited in place. A correction is a new record that references the original, and for a closed month it is booked in the running month.
- **Restrict cascades.** Critical relations such as Employee to TimeEntry, LeaveRequest and Absence use `onDelete: Restrict`.
- **One schema, one migration directory.** Migrations are versioned and never created with `db push`, see [Database migrations](../migrations.md).

The reasoning behind these rules is in [Compliance](../compliance.md).

## Request and error flow

All input is validated with Zod. A global error handler in `app.ts` turns validation errors into a `400` with German field-level messages. Other errors answer with the matching status and a German message. A route returns early with `reply.code(...).send({ error })` and does not throw. A unique-constraint conflict answers `409` with a code, and a write conflict answers `409` as well. The API's Swagger UI is served at `/docs` while it runs.

The web client wraps `fetch` in `apps/web/src/lib/api/client.ts`: it injects the token, retries once after a refresh on `401`, and throws an `ApiError` with the status. All user-facing texts are German and follow the [glossary](../glossar.md).
