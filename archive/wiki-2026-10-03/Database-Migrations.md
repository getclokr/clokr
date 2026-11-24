# Database Migrations

Clokr uses **versioned Prisma migrations** for every schema change. This gives an audit-traceable, reviewable history of how the database evolved — a hard requirement for an audit-proof (revisionssicher) system.

The Prisma schema lives at `packages/db/prisma/schema.prisma`, and migrations live in `packages/db/prisma/migrations/`.

> For most self-hosters this page is informational: in production the API container applies pending migrations **for you** on startup. You only need the dev workflow below if you build Clokr from source or develop against it.

See also: [[Deployment]] for the container update flow.

---

## Why versioned migrations (not `db push`)

`prisma db push` compares the live database to the schema and mutates the DB to match — it can **drop columns or reset data on boot** with no review and no history. That is unacceptable for a system that must preserve working-time and payroll records.

Versioned migrations fix this:

- **Reviewable** — each change is a committed SQL file, visible in code review.
- **Audit-traceable** — the applied history is recorded in the `_prisma_migrations` table; who/when/what is reconstructable.
- **Fails safely** — applying migrations against a database that has the schema but was never baselined fails cleanly (Prisma error `P3005`) and changes **nothing**, rather than silently "fixing" the schema.

**Rule: all schema changes go through versioned migrations, never `db push`** (outside of throwaway local iteration).

---

## The frozen `0_init` baseline

The first migration, `packages/db/prisma/migrations/0_init/`, is a **CREATE-only** snapshot of the schema as it existed when migrations were introduced. It contains no `DROP` / `TRUNCATE` / `DELETE` and no destructive `ALTER`.

**`0_init` is frozen.** Later schema changes always add a *new* migration on top of it. Never regenerate or edit `0_init` — doing so would rewrite history and break every already-migrated database.

On a genuinely **empty** database, `migrate deploy` simply runs `0_init` followed by any later migrations in order — no prompts, no data loss. This is exactly what a fresh production install does on first boot.

---

## Everyday development workflow

Create and apply a migration against your **local dev** database:

```bash
pnpm --filter @clokr/db exec prisma migrate dev --name <short-description>
```

This:

1. generates a new timestamped migration folder under `packages/db/prisma/migrations/`,
2. applies it to your local dev database,
3. regenerates the Prisma client.

**Commit the generated migration folder** along with the schema change.

> `migrate dev` needs a **shadow database** (Prisma creates and drops a temporary DB on the same server) and is **dev-only** — never run it against a production database.

Regenerate the Prisma client on its own (e.g. after pulling schema changes):

```bash
pnpm --filter @clokr/db exec prisma generate
```

---

## Applying migrations (every environment)

```bash
pnpm --filter @clokr/db exec prisma migrate deploy
```

`migrate deploy` applies all pending migrations in order and is safe to run repeatedly (already-applied migrations are skipped). It never drops data and never falls back to `db push`.

**In production you rarely run this by hand** — the API container's entrypoint (`apps/api/docker-entrypoint.sh`) runs `prisma migrate deploy` on every boot whenever a migrations directory is present (which is always, since `0_init` ships in the image). So a normal `pull` + `up -d` update applies new migrations automatically. In `production`, if no migrations directory were present the entrypoint fails loudly and exits rather than ever silently `db push`-ing.

---

## Writing safe migrations (additive guidance)

Because locked/finalized records must never be silently mutated, prefer **additive** migrations:

- Add new nullable columns, or columns with a safe default, rather than rewriting existing ones.
- Add indexes and new tables freely.
- Avoid destructive `DROP` / `TRUNCATE` on tables holding time entries, leave requests, absences, or audit logs. Deprecate-then-remove across releases if a column truly must go.
- Never regenerate `0_init`.

CI runs a **drift guard**: it fails the build if `schema.prisma` has diverged from the committed migration history (i.e. someone edited the schema without generating a migration). Keep schema and migrations in lockstep by always going through `migrate dev`.

---

## Failure semantics

- **`P3005: The database schema is not empty`** — the database has the schema but was never baselined into Prisma's migration history. This is the *safe* failure: nothing was applied and nothing was dropped. Do **not** force it and do **not** `db push`. This situation only arises on a database that pre-dates versioned migrations; a normal fresh install or a Clokr-managed database never hits it.

---

## Related pages

- [[Deployment]] — container update flow that triggers migrations
- [[Configuration]] — `DATABASE_URL` and pool settings
- [[Architecture]] — where the `@clokr/db` package sits in the stack
