/**
 * Issue #1011 — the break AMOUNT of a work day is decided in one place.
 *
 * `breakAmountFor()` (`contexts/time-tracking/break-amount.ts`) is the one rule: the
 * employee/tenant setting, raised to the § 11 JArbSchG minimum for a person under 18 on the work
 * date. The recording's automatic break and the roster's planned netto (`scheduling/shift-netto.ts`)
 * both call it, so a plan and a recording of the same times can never disagree.
 *
 * `getEffectiveBreakDuration()` is the ADULT-only setting lookup. A direct call is therefore a
 * second break rule unless it is one of the places named below. This gate pins every direct call of
 * production code by file and COUNT (never by line number):
 *
 *  - `break-amount.ts` x1: inside `breakAmountFor` itself.
 *  - `scheduling/api/shifts.ts` x1: the § 3 ArbZG daily-max check of PUT /shifts. Since Issue #1075
 *    POST nets through `shiftNettoMinutes` in `scheduling/shift-write-checks.ts`, the one gate.
 *    A minor is capped by § 8 / § 12 JArbSchG in `scheduling/minor-shift-limits.ts`, which nets
 *    through `shiftNettoMinutes` / `breakAmountFor` (Issue #1057) and runs before this check.
 *  - The three Arbeitszeitkonto closures (`close-employee-month.ts`, `month-saldo.ts`,
 *    `overtime-balance.ts`) are NOT listed: since Issue #1056 the SHIFT_BASED roster Soll goes through
 *    `rosterShiftBreakMinutes` -> `breakAmountFor`, pinned by `roster-minor-break-gate-1056.test.ts`.
 *    Their entries were REMOVED, which tightens this gate.
 *
 * A new direct call anywhere else fails here: route it through `breakAmountFor`, or — if it is a
 * deliberate, reasoned exception — extend `EXPECTED` with its reason.
 *
 * Named blind spot: an alias (`const f = getEffectiveBreakDuration; f(...)`) and a call through a
 * re-export under another name are not seen; the import of the name from `break-effective` is the
 * hook a reviewer would notice.
 *
 * Walk count MEASURED 2026-11-24: 349 production files (floor in MIN_WALKED_FILES); comments are not scanned (AST).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { describe, it, expect } from "vitest";
import * as ts from "typescript";

// __dirname is apps/api/src/__tests__ — four levels up is the repo root.
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const SRC_DIR = join(REPO_ROOT, "apps/api/src");
const FUNCTION_NAME = "getEffectiveBreakDuration";

/** The only production files that may call the adult-only lookup directly, with their counts. */
const EXPECTED: Record<string, { count: number; reason: string }> = {
  "apps/api/src/contexts/time-tracking/break-amount.ts": {
    count: 1,
    reason: "inside breakAmountFor, the one break-amount rule",
  },
  "apps/api/src/contexts/scheduling/api/shifts.ts": {
    count: 1,
    reason:
      "§ 3 ArbZG daily max of PUT /shifts for adults (POST nets through shiftNettoMinutes in shift-write-checks.ts since Issue #1075); minors are capped by § 8/§ 12 JArbSchG in minor-shift-limits.ts through breakAmountFor (Issue #1057)",
  },
};

/** Measured 349 production files on 2026-11-24; the floor (about 85 %) leaves room for removals, not an emptied tree. */
const MIN_WALKED_FILES = 295;

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

/** Number of CallExpressions whose callee is the identifier `getEffectiveBreakDuration`. */
function directCallCount(fileName: string, source: string): number {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === FUNCTION_NAME
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
}

describe("Issue #1011 — one break-amount rule for recording and roster", () => {
  const files = walkTs(SRC_DIR);
  const counts = new Map<string, number>();
  for (const abs of files) {
    const n = directCallCount(abs, readFileSync(abs, "utf8"));
    if (n > 0) counts.set(repoRel(abs), n);
  }

  it("the walk sees the tree (a silently-empty walk would pass forever)", () => {
    expect(files.length, "no production file walked at all").toBeGreaterThan(0);
    expect(
      files.length,
      "fewer files walked than the measured floor — the scan root moved or emptied",
    ).toBeGreaterThanOrEqual(MIN_WALKED_FILES);
    for (const file of Object.keys(EXPECTED)) {
      expect(
        files.map(repoRel),
        `the walk did not reach ${file} (moved or renamed — update the register)`,
      ).toContain(file);
    }
  });

  it("positive control: a direct call is counted, a comment or a bare mention is not", () => {
    expect(directCallCount("x.ts", `const m = getEffectiveBreakDuration(e, t, 400);`)).toBe(1);
    expect(
      directCallCount(
        "x.ts",
        `getEffectiveBreakDuration(a, b, 1); const y = getEffectiveBreakDuration(c, d, 2);`,
      ),
    ).toBe(2);
    expect(
      directCallCount(
        "x.ts",
        `// getEffectiveBreakDuration(e, t, 400)\nconst s = "getEffectiveBreakDuration(";`,
      ),
    ).toBe(0);
    expect(directCallCount("x.ts", `import { getEffectiveBreakDuration } from "./b";`)).toBe(0);
  });

  it("direct calls of getEffectiveBreakDuration exist only in the named, counted places", () => {
    const actual = Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const expected = Object.fromEntries(
      Object.entries(EXPECTED)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([file, { count }]) => [file, count]),
    );
    expect(
      actual,
      "a direct getEffectiveBreakDuration call is a second break rule: use breakAmountFor (Issue #1011)",
    ).toEqual(expected);
  });
});
