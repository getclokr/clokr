/**
 * Issue #606 (D-09) — the data-only migration that marks every user who has signed in at least once
 * as having seen the „Warum stempeln?“ intro, proven on REAL execution of the checked-in file (never
 * a restatement of it), same discipline as `hr-template-migration-86.test.ts`.
 *
 * - Static shape: one UPDATE on "User", the WHERE on "lastLoginAt", the object guard, no DDL and no
 *   INSERT / DELETE in the non-comment text.
 * - Execution: inside ONE interactive transaction a TEMP TABLE named "User" (LIKE the real one)
 *   shadows the real table for the unqualified name the file uses; the fixture rows live only there,
 *   the file's SQL runs twice against them, and the transaction is rolled back by a sentinel. The
 *   shared worker database's real "User" rows are never touched.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp } from "./setup";

// __dirname is apps/api/src/__tests__ — four levels up is the repo root.
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const MIGRATIONS_ROOT = join(REPO_ROOT, "packages", "db", "prisma", "migrations");
const MIGRATION_DIR_SUFFIX = "_why_clock_intro_seen_existing_users";

function locateMigrationDir(): string {
  const entries = readdirSync(MIGRATIONS_ROOT);
  if (entries.length === 0) {
    throw new Error(`why-clock-intro migration: ${MIGRATIONS_ROOT} lists no entries at all`);
  }
  const matches = entries.filter((name) => name.endsWith(MIGRATION_DIR_SUFFIX));
  if (matches.length !== 1) {
    throw new Error(
      `why-clock-intro migration: expected exactly one directory ending in "${MIGRATION_DIR_SUFFIX}", ` +
        `found ${matches.length}: ${JSON.stringify(matches)}`,
    );
  }
  return matches[0];
}

const MIGRATION_PATH = join(MIGRATIONS_ROOT, locateMigrationDir(), "migration.sql");
const SQL = readFileSync(MIGRATION_PATH, "utf8");

/** Non-comment lines only: a `--` comment may legitimately mention any checked keyword. */
function nonCommentText(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

class RollbackSentinel extends Error {}

describe("Issue #606 — why-clock-intro seen-state migration, static shape", () => {
  const body = nonCommentText(SQL);

  it('is exactly one UPDATE on the unqualified "User" table, limited to users who signed in', () => {
    expect(body.match(/\bUPDATE\b/g)).toHaveLength(1);
    expect(body).toContain('UPDATE "User"');
    expect(body).toContain('WHERE "lastLoginAt" IS NOT NULL');
  });

  it("guards a non-object stored value and merges the key instead of replacing the object", () => {
    expect(body).toContain("jsonb_typeof(\"uiPreferences\") = 'object'");
    expect(body).toContain("'{}'::jsonb");
    expect(body).toContain("|| '{\"whyClockIntroSeen\": true}'::jsonb");
  });

  it("has no DDL, no INSERT, no DELETE and does not touch updatedAt", () => {
    expect(body).not.toMatch(/\b(CREATE|ALTER|DROP|INSERT|DELETE|TRUNCATE)\b/i);
    expect(body).not.toContain("updatedAt");
  });
});

describe("Issue #606 — why-clock-intro seen-state migration, real execution", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });
  afterAll(async () => {
    await closeTestApp();
  });

  it("marks signed-in users, merges into the stored object, heals non-objects, leaves never-signed-in users alone and is idempotent", async () => {
    type Row = { id: string; uiPreferences: unknown };
    let afterFirst: Row[] = [];
    let afterSecond: Row[] = [];
    let realUserRows = -1;

    await app.prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `CREATE TEMP TABLE "User" (LIKE public."User" INCLUDING DEFAULTS) ON COMMIT DROP`,
        );
        // The temp table must shadow the real one for the file's unqualified name.
        const shadow = await tx.$queryRawUnsafe<{ schema: string }[]>(
          `SELECT n.nspname AS schema FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.oid = to_regclass('"User"')`,
        );
        expect(shadow[0].schema.startsWith("pg_temp")).toBe(true);

        const insert = (
          id: string,
          prefs: string | null,
          lastLogin: string | null,
        ): Promise<number> =>
          tx.$executeRawUnsafe(
            `INSERT INTO "User" (id, email, "passwordHash", "uiPreferences", "lastLoginAt", "updatedAt")
             VALUES ($1, $2, 'x', ${prefs === null ? "NULL" : `'${prefs}'::jsonb`},
                     ${lastLogin === null ? "NULL" : `'${lastLogin}'::timestamptz`}, now())`,
            id,
            `${id}@test.de`,
          );
        const signedIn = "2026-11-01T08:00:00Z";
        await insert("mig-theme", '{"theme": "salz"}', signedIn);
        await insert("mig-array", "[1, 2]", signedIn);
        await insert("mig-sqlnull", null, signedIn);
        await insert("mig-jsonnull", "null", signedIn);
        await insert("mig-never", '{"theme": "petrol"}', null);
        await insert("mig-never-null", null, null);

        await tx.$executeRawUnsafe(SQL);
        afterFirst = await tx.$queryRawUnsafe<Row[]>(
          `SELECT id, "uiPreferences" FROM "User" ORDER BY id`,
        );
        await tx.$executeRawUnsafe(SQL);
        afterSecond = await tx.$queryRawUnsafe<Row[]>(
          `SELECT id, "uiPreferences" FROM "User" ORDER BY id`,
        );
        // The real table stays untouched inside the same transaction.
        const real = await tx.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) AS n FROM public."User" WHERE id LIKE 'mig-%'`,
        );
        realUserRows = Number(real[0].n);
        throw new RollbackSentinel();
      })
      .catch((error) => {
        if (!(error instanceof RollbackSentinel)) throw error;
      });

    const byId = Object.fromEntries(afterFirst.map((r) => [r.id, r.uiPreferences]));
    expect(afterFirst).toHaveLength(6);
    expect(byId["mig-theme"]).toEqual({ theme: "salz", whyClockIntroSeen: true });
    expect(byId["mig-array"]).toEqual({ whyClockIntroSeen: true });
    expect(byId["mig-sqlnull"]).toEqual({ whyClockIntroSeen: true });
    expect(byId["mig-jsonnull"]).toEqual({ whyClockIntroSeen: true });
    // A person who never signed in is untouched and gets the card at the first sign-in.
    expect(byId["mig-never"]).toEqual({ theme: "petrol" });
    expect(byId["mig-never-null"]).toBeNull();
    // A second run changes nothing further.
    expect(afterSecond).toEqual(afterFirst);
    expect(realUserRows).toBe(0);
  });
});
