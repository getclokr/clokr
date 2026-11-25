/**
 * Issue #1057 — every code path that writes working time into a `Shift` row is registered, with a
 * verdict on whether the § 8 / § 12 JArbSchG roster check (`scheduling/minor-shift-limits.ts`)
 * covers it.
 *
 * The case class is the call pattern, not the keyword: a call `<expr>.shift.create|createMany|
 * update|updateMany|upsert(` in non-test code under `apps/api/src`, pinned by file, method and COUNT
 * (never by line number). A second assertion pins the six direct calls of
 * `findMinorShiftLimitViolation` in `scheduling/api/shifts.ts` (POST, PUT, restore, bulk,
 * generate-week, copy-week).
 *
 * Verdicts:
 *  - `checked`      the write adds or moves working time and the JArbSchG check runs before it.
 *  - `no-time`      the write adds no working time (a flag, a note, a soft delete): no check needed.
 *  - `not-checked`  the write adds working time and is NOT checked — a known gap with its own
 *                   follow-up issue (the Phorest sync leads and cannot refuse a plan).
 *
 * A new write path fails here: route it through the check (`loadMinorShiftWeeks` +
 * `findMinorShiftLimitViolation`) and register it as `checked`, or register it with a written reason.
 *
 * Named blind spots: a write through an alias (`const s = prisma.shift; s.create(...)`), a nested
 * write (`employee.update({ data: { shifts: { create } } })`), a raw SQL statement, and the
 * operator/seed scripts outside `apps/api/src` (`scripts/backfill-mai-shifts.ts`,
 * `scripts/measure-saldo-path-parity.ts`, `packages/db/src/seed-demo.ts`) are not seen.
 * Comments and strings are not scanned (AST).
 *
 * Walk count MEASURED 2026-11-25: 351 production files (floor in MIN_WALKED_FILES).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { describe, it, expect } from "vitest";
import * as ts from "typescript";

// __dirname is apps/api/src/__tests__ — four levels up is the repo root.
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const SRC_DIR = join(REPO_ROOT, "apps/api/src");

const WRITE_METHODS = ["create", "createMany", "update", "updateMany", "upsert"] as const;
type WriteMethod = (typeof WRITE_METHODS)[number];
type Verdict = "checked" | "no-time" | "not-checked";

interface RegisterEntry {
  count: number;
  verdict: Verdict;
  reason: string;
}

const SHIFTS_ROUTE = "apps/api/src/contexts/scheduling/api/shifts.ts";

/** Every production Shift write, by file and method. */
const REGISTER: Record<string, Partial<Record<WriteMethod, RegisterEntry>>> = {
  [SHIFTS_ROUTE]: {
    create: {
      count: 4,
      verdict: "checked",
      reason: "POST /, POST /generate-week, POST /copy-week, POST /bulk",
    },
    update: {
      count: 2,
      verdict: "checked",
      reason:
        "PUT /:id; POST /:id/restore (the soft-delete branch is checked, the flag-clearing branch adds no time)",
    },
  },
  "apps/api/src/contexts/scheduling/facade/shifts.ts": {
    updateMany: {
      count: 2,
      verdict: "no-time",
      reason: "conflictsWithLeave flag; DSGVO note cleared to null",
    },
  },
  "apps/api/src/contexts/scheduling/shift-cleanup.ts": {
    update: {
      count: 2,
      verdict: "no-time",
      reason: "Berufsschule soft delete and the past-day flag only remove or mark time",
    },
  },
  "apps/api/src/contexts/scheduling/shift-leave-check.ts": {
    updateMany: { count: 1, verdict: "no-time", reason: "conflictsWithLeave flag" },
  },
  "apps/api/src/services/phorest/sync-shifts.ts": {
    update: {
      count: 3,
      verdict: "not-checked",
      reason:
        "adopt writes padded Phorest times (NOT checked: Phorest leads, a sync cannot refuse, own follow-up issue); PHOREST_REMOVED and PHOREST_REPLACED soft deletes reduce time",
    },
    upsert: {
      count: 1,
      verdict: "not-checked",
      reason: "import of a Phorest shift (NOT checked: Phorest leads, own follow-up issue)",
    },
  },
};

/** Measured 351 production files on 2026-11-25; the floor (about 85 %) leaves room for removals, not an emptied tree. */
const MIN_WALKED_FILES = 299;

const CHECK_FUNCTION = "findMinorShiftLimitViolation";
const EXPECTED_CHECK_CALLS = 6;

function repoRel(absPath: string): string {
  return relative(REPO_ROOT, absPath).split("\\").join("/");
}

function walkTs(absDir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(absDir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const abs = join(absDir, entry);
    if (statSync(abs).isDirectory()) walkTs(abs, out);
    else if (extname(entry) === ".ts" && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
      out.push(abs);
    }
  }
  return out;
}

/** Counts of `<expr>.shift.<write method>(...)` calls per method. */
function shiftWriteCalls(fileName: string, source: string): Partial<Record<WriteMethod, number>> {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const counts: Partial<Record<WriteMethod, number>> = {};
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (WRITE_METHODS as readonly string[]).includes(node.expression.name.text) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === "shift"
    ) {
      const method = node.expression.name.text as WriteMethod;
      counts[method] = (counts[method] ?? 0) + 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return counts;
}

/** Number of CallExpressions whose callee is the identifier `findMinorShiftLimitViolation`. */
function checkCallCount(fileName: string, source: string): number {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === CHECK_FUNCTION
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
}

describe("Issue #1057 — every Shift write path is registered with a verdict", () => {
  const files = walkTs(SRC_DIR);
  const actual: Record<string, Partial<Record<WriteMethod, number>>> = {};
  for (const abs of files) {
    const calls = shiftWriteCalls(abs, readFileSync(abs, "utf8"));
    if (Object.keys(calls).length > 0) actual[repoRel(abs)] = calls;
  }

  it("the walk sees the tree (a silently-empty walk would pass forever)", () => {
    expect(files.length, "no production file walked at all").toBeGreaterThan(0);
    expect(
      files.length,
      "fewer files walked than the measured floor — the scan root moved or emptied",
    ).toBeGreaterThanOrEqual(MIN_WALKED_FILES);
    for (const file of Object.keys(REGISTER)) {
      expect(
        files.map(repoRel),
        `the walk did not reach ${file} (moved or renamed — update the register)`,
      ).toContain(file);
    }
  });

  it("positive control: a Shift write call is counted, a comment, a string or another model is not", () => {
    expect(shiftWriteCalls("x.ts", `await tx.shift.create({ data });`)).toEqual({ create: 1 });
    expect(
      shiftWriteCalls(
        "x.ts",
        `await app.prisma.shift.update({}); await db.shift.updateMany({}); await tx.shift.update({});`,
      ),
    ).toEqual({ update: 2, updateMany: 1 });
    expect(
      shiftWriteCalls(
        "x.ts",
        `// tx.shift.create({})\nconst s = "tx.shift.update(";\nawait tx.shiftTemplate.create({});\nawait tx.shift.findMany({});`,
      ),
    ).toEqual({});
    expect(checkCallCount("x.ts", `const v = findMinorShiftLimitViolation(w, c);`)).toBe(1);
    expect(
      checkCallCount(
        "x.ts",
        `// findMinorShiftLimitViolation(w, c)\nimport { findMinorShiftLimitViolation } from "./m";`,
      ),
    ).toBe(0);
  });

  it("Shift writes exist only in the registered files, methods and counts", () => {
    const expected = Object.fromEntries(
      Object.entries(REGISTER)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([file, methods]) => [
          file,
          Object.fromEntries(
            Object.entries(methods).map(([method, entry]) => [method, entry.count]),
          ),
        ]),
    );
    const sortedActual = Object.fromEntries(
      Object.entries(actual).sort(([a], [b]) => a.localeCompare(b)),
    );
    expect(
      sortedActual,
      "a new Shift write path: route it through loadMinorShiftWeeks + findMinorShiftLimitViolation (Issue #1057) or register it with a verdict and a reason",
    ).toEqual(expected);
  });

  it("every registered entry carries a verdict and a written reason", () => {
    for (const [file, methods] of Object.entries(REGISTER)) {
      for (const [method, entry] of Object.entries(methods)) {
        expect(entry.reason.length, `${file} ${method} has no reason`).toBeGreaterThan(10);
        expect(["checked", "no-time", "not-checked"]).toContain(entry.verdict);
      }
    }
  });

  it("the roster route calls the JArbSchG check exactly once per checked write path", () => {
    const abs = join(REPO_ROOT, SHIFTS_ROUTE);
    expect(
      checkCallCount(abs, readFileSync(abs, "utf8")),
      "POST, PUT, restore, bulk, generate-week and copy-week each call findMinorShiftLimitViolation once",
    ).toBe(EXPECTED_CHECK_CALLS);
  });
});
