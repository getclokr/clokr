# Architecture

This page gives contributors and self-hosters a high-level map of how Clokr is built. For running it, see [[Deployment]] and [[Configuration]]; for the schema layer, see [[Database-Migrations]].

---

## Three-tier overview

```
Browser (SvelteKit SPA)
        │  HTTPS (via your reverse proxy)
        ▼
Web container  ──API proxy──►  API container (Fastify REST)
   (port 3000)                    (port 4000)
                                      │  Prisma
                                      ▼
                               PostgreSQL 18
                         (+ Redis 7, MinIO storage)
```

- **Web** — a SvelteKit app (Svelte 5 runes) rendered client-side. It fetches all data from the API over HTTP; there is no server-side data fetching. The web server also proxies `/api/*` to the backend and sets CSP headers.
- **API** — a Fastify 5 REST service that owns all business logic, validation (Zod), authentication, and data access.
- **Database** — PostgreSQL 18 accessed exclusively through Prisma 7. Redis and MinIO provide caching and object storage respectively.

---

## Tech stack

| Layer     | Technology                                      |
| --------- | ----------------------------------------------- |
| Frontend  | SvelteKit + Svelte 5 (runes), TypeScript, Vite  |
| Backend   | Fastify 5, TypeScript, Zod validation           |
| ORM / DB  | Prisma 7 → PostgreSQL 18                         |
| Cache     | Redis 7                                          |
| Storage   | MinIO (S3-compatible)                            |
| Auth      | JWT (access + refresh) + optional email OTP     |
| Runtime   | Node.js 24 (alpine containers)                  |
| Tooling   | pnpm 10 workspaces, Turbo, Vitest, Playwright   |

---

## Monorepo layout

Clokr is a pnpm workspace:

```
clokr/
├── apps/
│   ├── api/          # Fastify backend (routes, plugins, middleware, utils)
│   ├── web/          # SvelteKit frontend (Svelte 5 components, stores, API client)
│   ├── e2e/          # Playwright end-to-end tests
│   └── nfc-client/   # Tauri desktop client for NFC card clock-in/out
├── packages/
│   ├── db/           # Prisma schema + generated client (@clokr/db)
│   └── types/        # Shared TypeScript types (@clokr/types)
├── docker-compose.yml
├── docker-compose.prod.yml
└── .env.example
```

- `@clokr/db` — the single source of database access; both the API and migrations import it.
- `@clokr/types` — shared interfaces (Role, Employee, TimeEntry, LeaveRequest, …) used by both API and web so the contract stays in sync.

---

## API composition: the plugin pattern

The Fastify app (`apps/api/src/app.ts`) is composed from **plugins** that decorate the app instance with cross-cutting services, registered via `fastify-plugin`. Route handlers then use them as `app.prisma`, `app.audit()`, etc.

| Plugin       | Responsibility |
| ------------ | -------------- |
| `prisma`     | Database client, injected as `app.prisma`. |
| `audit`      | `app.audit()` — writes an `AuditLog` entry (user, action, entity, old/new, IP, UA) for every mutation. |
| `mailer`     | SMTP e-mail (invitations, notifications). |
| `notify`     | In-app notifications (the notification bell). |
| `storage`    | MinIO / S3 file storage (avatars, absence documents). |
| `scheduler`  | Cron scheduling host for background jobs (incl. Phorest sync). |

Routes are grouped by domain, each exporting an `async function xxxRoutes(app)` registered under a URL prefix — e.g. `time-entries.ts`, `employees.ts`, `leave.ts`, `auth.ts`, `reports.ts`.

Authentication/authorization is middleware (`middleware/auth.ts`): `requireAuth` verifies a JWT or a `clk_`-prefixed API key; `requireRole(...)` layers a role check. These run as route `preHandler`s.

---

## Background jobs (in-process cron)

Clokr runs scheduled work **in-process** with `node-cron` — there is no external job queue. Each job plugin registers its cron tasks, starts them on the app's `onReady` hook, stops them on `onClose`, and iterates over all tenants (tenant-aware). Automated actions are attributed to a SYSTEM user in the audit log.

| Job                | What it does |
| ------------------ | ------------ |
| Monthly close      | Automatic Monatsabschluss: closes months, runs completeness checks, notifies managers about missing entries. |
| Data retention     | Annual archival/soft-delete of records past the tenant's retention period (default 10 years). |
| Phorest sync       | One-way import of shifts and a read-only appointment cache from Phorest (see [Phorest-Integration](Phorest-Integration)). |
| Attendance checker | Periodic attendance/compliance checks. |

---

## Data model conventions

- **Multi-tenancy** — every employee-scoped row carries a `tenantId`; the JWT payload includes it and all queries filter by it. Per-tenant settings live in `TenantConfig`.
- **Soft delete** — core models (`TimeEntry`, `LeaveRequest`, `Absence`) use `deletedAt`; queries always include `deletedAt: null`.
- **Immutability after lock** — closed months (`isLocked`) are never edited in place; corrections are new referencing records.
- **Restrict cascades** — critical relations (Employee → TimeEntry/LeaveRequest/Absence) use `onDelete: Restrict` to prevent silent cascade deletion.

See [[Compliance & Revisionssicherheit|Compliance-und-Revisionssicherheit]] for the reasoning behind these rules.

---

## Key API endpoints

Swagger UI is served at `/docs` while the API is running. A few representative endpoints:

- `POST /api/v1/auth/login`
- `GET  /api/v1/dashboard`
- `GET/POST /api/v1/time-entries`
- `GET/POST /api/v1/leave/requests`
- `GET  /api/v1/reports/monthly`
- `GET  /api/v1/reports/datev` (DATEV CSV export)

---

## Request & error flow

- All input is validated with Zod schemas at the top of each route file. A global error handler converts `ZodError`s into `400` responses with German field-level messages; other errors return an appropriate status with a German user-facing message.
- The web client (`apps/web/src/lib/api/client.ts`) wraps fetch, injects the auth token, auto-refreshes on `401`, and throws a typed `ApiError`.
- Logging is structured (Pino, JSON by default; ECS or pretty via `LOG_FORMAT`). Client-side errors are batched and posted to `/api/v1/logs/client`.

---

## Related pages

- [[Deployment]] — running the stack
- [[Configuration]] — environment variables
- [[Database-Migrations]] — schema evolution
- [[Security & CVE Handling|Security-and-CVE-Handling]] — auth, encryption, CVE process
- [[Phorest-Integration]] — the external calendar integration
