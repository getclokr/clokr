/**
 * Issue #1057 — every code path that writes working time into a `Shift` row is registered, with a
 * verdict on whether the § 8 / § 12 JArbSchG roster check (`scheduling/minor-shift-limits.ts`)
 * covers it.
 *
 * The case class is the call pattern, not the keyword: a call `<expr>.shift.create|createMany|
 * update|updateMany|upsert(` in non-test code under `apps/api/src`, pinned by file, method and COUNT
 * (never by line number). Since Issue #1075 the six adding paths of `scheduling/api/shifts.ts` (POST,
 * PUT, restore, bulk, generate-week, copy-week) reach the JArbSchG rule — and five more — through ONE
 * gate, `checkShiftWrite` (`scheduling/shift-write-checks.ts`); the one call of
 * `reportMinorShiftLimitViolations` in `services/phorest/sync-shifts.ts` must come after every Shift
 * write of that file.
 *
 * Issue #1075 added the per-path register `WRITE_PATHS`: for each adding handler of the roster route
 * which rules run (always all six, imported from the gate module so the register cannot drift from
 * the code), how a finding is answered (`refuse`, `skip-cell`, `refuse-batch`) and whether `?force`
 * exists. The AST checks pin that each of those handlers calls `checkShiftWrite` exactly once, before
 * every Shift write of the handler, that the gate calls its six rule functions once each in
 * `SHIFT_WRITE_RULES` order, and that the roster route computes none of the rules itself. DELETE
 * removes time and keeps only the past lock (`isPastShiftDay`).
 *
 * Verdicts:
 *  - `checked`      the write adds or moves working time and the JArbSchG check runs before it.
 *  - `no-time`      the write adds no working time (a flag, a note, a soft delete): no check needed.
 *  - `reported`     the write adds working time that Clokr may not refuse (the Phorest sync
 *                   leads, Issue #1074) and the end-of-run report `reportMinorShiftLimitViolations`
 *                   tells the planners about every § 8 / § 12 finding of the week.
 *  - `not-checked`  the write adds working time and is NOT checked — a known gap that needs its own
 *                   follow-up issue. None is registered today.
 *
 * A new write path fails here: route it through `checkShiftWrite`, register it as `checked` (and in
 * `WRITE_PATHS`), or register it with a written reason.
 *
 * Named blind spots: a write through an alias (`const s = prisma.shift; s.create(...)`), a nested
 * write (`employee.update({ data: { shifts: { create } } })`), a raw SQL statement, and the
 * operator/seed scripts outside `apps/api/src` (`scripts/backfill-mai-shifts.ts`,
 * `scripts/measure-saldo-path-parity.ts`, `packages/db/src/seed-demo.ts`) are not seen.
 * Comments and strings are not scanned (AST).
 *
 * Walk count MEASURED 2026-11-25: 352 production files, 351 before Issue #1074 added the report
 * module (floor in MIN_WALKED_FILES).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { SHIFT_WRITE_RULES, type ShiftWriteRule } from "../contexts/scheduling/shift-write-checks";

// __dirname is apps/api/src/__tests__ — four levels up is the repo root.
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const SRC_DIR = join(REPO_ROOT, "apps/api/src");

const WRITE_METHODS = ["create", "createMany", "update", "updateMany", "upsert"] as const;
type WriteMethod = (typeof WRITE_METHODS)[number];
type Verdict = "checked" | "no-time" | "reported" | "not-checked";

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
      reason:
        "POST /, POST /generate-week, POST /copy-week, POST /bulk — each through checkShiftWrite, all six rules (Issue #1075)",
    },
    update: {
      count: 2,
      verdict: "checked",
      reason:
        "PUT /:id; POST /:id/restore — through checkShiftWrite, all six rules; on restore the soft-delete branch is checked and the flag-clearing branch adds no time (Issue #1075)",
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
      verdict: "reported",
      reason:
        "adopt writes padded Phorest times (reported, not refused: Phorest leads, Issue #1074); PHOREST_REMOVED and PHOREST_REPLACED soft deletes reduce time",
    },
    upsert: {
      count: 1,
      verdict: "reported",
      reason: "import of a Phorest shift (reported, not refused: Phorest leads, Issue #1074)",
    },
  },
};

/** Measured 351 production files on 2026-11-25; the floor (about 85 %) leaves room for removals, not an emptied tree. */
const MIN_WALKED_FILES = 299;

const CHECK_FUNCTION = "findMinorShiftLimitViolation";
// 0 since Issue #1075: every adding path reaches the JArbSchG rule through checkShiftWrite, which
// calls findMinorShiftLimitViolation once, in shift-write-checks.ts.
const EXPECTED_CHECK_CALLS = 0;

const GATE_FUNCTION = "checkShiftWrite";
const GATE_MODULE = "apps/api/src/contexts/scheduling/shift-write-checks.ts";
const PAST_LOCK_FUNCTION = "isPastShiftDay";

type Answer = "refuse" | "skip-cell" | "refuse-batch";

interface WritePath {
  /** The rules the gate runs on this path (all six; imported so the register follows the code). */
  rules: readonly ShiftWriteRule[];
  /** How a blocking finding is answered. */
  answer: Answer;
  /** Whether `?force=true` can override an overridable finding (opening hours, § 5). */
  force: boolean;
  reason: string;
}

/**
 * Every handler of the roster route that ADDS planned working time, by "<METHOD> <path>". DELETE
 * /:id is deliberately absent: it removes time and keeps only the past lock (`isPastShiftDay`).
 */
const WRITE_PATHS: Record<string, WritePath> = {
  "POST /": {
    rules: SHIFT_WRITE_RULES,
    answer: "refuse",
    force: true,
    reason:
      "a single write: opening hours and § 5 ArbZG are a per-shift, audited decision (SHIFT_FORCED_OUTSIDE_HOURS / SHIFT_FORCED_OVER_ARBZG); the rest answers 422",
  },
  "PUT /:id": {
    rules: SHIFT_WRITE_RULES,
    answer: "refuse",
    force: true,
    reason:
      "a single write like POST over the effective values; the stored row is taken out of the day sum, the rest gaps and the minor week, so only a worse write is refused",
  },
  "POST /:id/restore": {
    rules: SHIFT_WRITE_RULES,
    answer: "refuse",
    force: true,
    reason:
      "a single deliberate write like POST; only the soft-delete branch adds time and is gated, the flag-clearing branch changes no time, person or day",
  },
  "POST /bulk": {
    rules: SHIFT_WRITE_RULES,
    answer: "refuse-batch",
    force: false,
    reason:
      "a collective path: the first finding refuses the whole batch with itemIndex and canForce false, nothing is written; no override replicates unseen",
  },
  "POST /generate-week": {
    rules: SHIFT_WRITE_RULES,
    answer: "skip-cell",
    force: false,
    reason:
      "a collective path: a violating cell is skipped with reason and message, identically in preview and commit; the planner places that one shift through POST",
  },
  "POST /copy-week": {
    rules: SHIFT_WRITE_RULES,
    answer: "skip-cell",
    force: false,
    reason:
      "a collective path: a violating cell is skipped with reason and message, identically in preview and commit; the planner places that one shift through POST",
  },
};

const REPORT_FUNCTION = "reportMinorShiftLimitViolations";
const PHOREST_SYNC = "apps/api/src/services/phorest/sync-shifts.ts";

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

/** Number of CallExpressions whose callee is the identifier `name` (default: the write check). */
function checkCallCount(fileName: string, source: string, name: string = CHECK_FUNCTION): number {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
}

/** Start offsets of the identifier calls `name(` and of every `<expr>.shift.<write>(` call. */
function callPositions(
  fileName: string,
  source: string,
  name: string,
): { named: number[]; shiftWrites: number[] } {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const named: number[] = [];
  const shiftWrites: number[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === name) {
        named.push(node.getStart(sf));
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        (WRITE_METHODS as readonly string[]).includes(node.expression.name.text) &&
        ts.isPropertyAccessExpression(node.expression.expression) &&
        node.expression.expression.name.text === "shift"
      ) {
        shiftWrites.push(node.getStart(sf));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { named, shiftWrites };
}

interface HandlerInfo {
  key: string;
  gateCalls: number[];
  pastLockCalls: number;
  shiftWrites: number[];
}

/** The route handlers (`app.<get|post|put|patch|delete>("<path>", ...)`) of a source, by "<METHOD> <path>". */
function routeHandlers(fileName: string, source: string): HandlerInfo[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const out: HandlerInfo[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["get", "post", "put", "patch", "delete"].includes(node.expression.name.text) &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const info: HandlerInfo = {
        key: `${node.expression.name.text.toUpperCase()} ${node.arguments[0].text}`,
        gateCalls: [],
        pastLockCalls: 0,
        shiftWrites: [],
      };
      const inner = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) {
          if (ts.isIdentifier(n.expression) && n.expression.text === GATE_FUNCTION) {
            info.gateCalls.push(n.getStart(sf));
          } else if (ts.isIdentifier(n.expression) && n.expression.text === PAST_LOCK_FUNCTION) {
            info.pastLockCalls += 1;
          } else if (
            ts.isPropertyAccessExpression(n.expression) &&
            (WRITE_METHODS as readonly string[]).includes(n.expression.name.text) &&
            ts.isPropertyAccessExpression(n.expression.expression) &&
            n.expression.expression.name.text === "shift"
          ) {
            info.shiftWrites.push(n.getStart(sf));
          }
        }
        ts.forEachChild(n, inner);
      };
      ts.forEachChild(node, inner);
      out.push(info);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Callee names ending in `Rule`, in source order, inside the body of `function checkShiftWrite`. */
function gateRuleOrder(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === GATE_FUNCTION && node.body) {
      const inner = (n: ts.Node): void => {
        if (
          ts.isCallExpression(n) &&
          ts.isIdentifier(n.expression) &&
          n.expression.text.endsWith("Rule")
        ) {
          names.push(n.expression.text);
        }
        ts.forEachChild(n, inner);
      };
      ts.forEachChild(node.body, inner);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

/** Names of every function declared in a source (declarations, not calls). */
function declaredFunctions(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) names.push(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
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
    expect(
      checkCallCount("x.ts", `await reportMinorShiftLimitViolations(app, i);`, REPORT_FUNCTION),
    ).toBe(1);
    expect(
      checkCallCount(
        "x.ts",
        `import { reportMinorShiftLimitViolations } from "./m"; // reportMinorShiftLimitViolations(app, i)`,
        REPORT_FUNCTION,
      ),
    ).toBe(0);
    const positions = callPositions(
      "x.ts",
      `await tx.shift.update({});\nawait reportMinorShiftLimitViolations(app, i);`,
      REPORT_FUNCTION,
    );
    expect(positions.shiftWrites).toHaveLength(1);
    expect(positions.named).toHaveLength(1);
    expect(positions.named[0]).toBeGreaterThan(positions.shiftWrites[0]);
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
        expect(["checked", "no-time", "reported", "not-checked"]).toContain(entry.verdict);
      }
    }
  });

  it("positive control: handlers are found by method and path, calls are counted by position, comments and strings are not", () => {
    const src = [
      `app.post("/x", { handler: async () => { checkShiftWrite(ctx, c, o); await tx.shift.create({}); } });`,
      `app.delete("/:id", { handler: async () => { if (isPastShiftDay(a, b)) return; await tx.shift.delete({}); } });`,
      `// checkShiftWrite(a, b, c)\nconst note = "checkShiftWrite(";`,
    ].join("\n");
    const found = routeHandlers("x.ts", src);
    expect(found.map((h) => h.key)).toEqual(["POST /x", "DELETE /:id"]);
    expect(found[0].gateCalls).toHaveLength(1);
    expect(found[0].gateCalls[0]).toBeLessThan(found[0].shiftWrites[0]);
    expect(found[1].gateCalls).toHaveLength(0);
    expect(found[1].pastLockCalls).toBe(1);
    expect(
      gateRuleOrder(
        "x.ts",
        `function checkShiftWrite() { const steps = [() => aRule(), () => bRule()]; helper(); }`,
      ),
    ).toEqual(["aRule", "bRule"]);
    expect(declaredFunctions("x.ts", `function a() {}\nconst b = () => 1;`)).toEqual(["a"]);
  });

  describe("every adding write path of the roster route runs the one gate (Issue #1075)", () => {
    const abs = join(REPO_ROOT, SHIFTS_ROUTE);
    const source = readFileSync(abs, "utf8");
    const handlers = routeHandlers(abs, source);

    it("the handlers that contain a Shift write are exactly the registered write paths", () => {
      const writers = handlers.filter((h) => h.shiftWrites.length > 0).map((h) => h.key);
      expect(
        writers.length,
        "no handler with a Shift write found — the scan is vacuous",
      ).toBeGreaterThan(0);
      expect(
        [...writers].sort(),
        "a roster handler writes a Shift without being registered: route it through checkShiftWrite and add it to WRITE_PATHS",
      ).toEqual(Object.keys(WRITE_PATHS).sort());
    });

    it("each of them calls checkShiftWrite exactly once, before every Shift write of the handler", () => {
      for (const key of Object.keys(WRITE_PATHS)) {
        const h = handlers.find((x) => x.key === key);
        expect(h, `${key} not found in ${SHIFTS_ROUTE}`).toBeDefined();
        expect(h!.gateCalls, `${key} must call ${GATE_FUNCTION} exactly once`).toHaveLength(1);
        for (const write of h!.shiftWrites) {
          expect(h!.gateCalls[0], `${key}: the gate must run before the Shift write`).toBeLessThan(
            write,
          );
        }
      }
    });

    it("the register states rules, answer and force for every path, and the force path set is POST, PUT and restore", () => {
      for (const [key, path] of Object.entries(WRITE_PATHS)) {
        expect([...path.rules], `${key}: all six rules run on every adding path`).toEqual([
          ...SHIFT_WRITE_RULES,
        ]);
        expect(["refuse", "skip-cell", "refuse-batch"]).toContain(path.answer);
        expect(path.reason.length, `${key} has no reason`).toBeGreaterThan(10);
      }
      expect(
        Object.entries(WRITE_PATHS)
          .filter(([, p]) => p.force)
          .map(([k]) => k)
          .sort(),
      ).toEqual(["POST /", "POST /:id/restore", "PUT /:id"]);
      expect(
        Object.entries(WRITE_PATHS)
          .filter(([, p]) => p.answer !== "refuse")
          .map(([k]) => k)
          .sort(),
      ).toEqual(["POST /bulk", "POST /copy-week", "POST /generate-week"]);
    });

    it("the roster route computes no rule itself: no direct rule call, no old guard helper", () => {
      for (const name of [
        CHECK_FUNCTION,
        "loadMinorShiftWeeks",
        "getEffectiveBreakDuration",
        "shiftNettoMinutes",
      ]) {
        expect(
          checkCallCount(abs, source, name),
          `${SHIFTS_ROUTE} must not call ${name} itself; the gate does`,
        ).toBe(0);
      }
      expect(checkCallCount(abs, source, CHECK_FUNCTION)).toBe(EXPECTED_CHECK_CALLS);
      const declared = declaredFunctions(abs, source);
      for (const old of [
        "assertEmployeeHasContractOn",
        "assertShiftNotPast",
        "assertWithinStoreHours",
        "assertArbZGDailyMax",
        "assertArbZGRestPeriod",
      ]) {
        expect(declared, `${old} is back in ${SHIFTS_ROUTE}`).not.toContain(old);
      }
    });

    it("the past lock outside the gate is DELETE /:id only; GET /conflicts reads the same predicate and writes nothing (Issue #1100)", () => {
      const withPastLock = handlers.filter((h) => h.pastLockCalls > 0).map((h) => h.key);
      expect(withPastLock).toEqual(["DELETE /:id", "GET /conflicts"]);
      const conflicts = handlers.find((h) => h.key === "GET /conflicts");
      expect(conflicts, "GET /conflicts not found").toBeDefined();
      expect(
        conflicts!.shiftWrites,
        "GET /conflicts only tells the list which days the past rule refuses, it must never write a Shift",
      ).toEqual([]);
      expect(conflicts!.gateCalls, "GET /conflicts runs no gate").toEqual([]);
    });
  });

  describe("the gate itself (Issue #1075)", () => {
    const abs = join(REPO_ROOT, GATE_MODULE);
    const source = readFileSync(abs, "utf8");

    it("checkShiftWrite calls its six rule functions once each, in SHIFT_WRITE_RULES order", () => {
      const order = gateRuleOrder(abs, source);
      expect(order, "the gate body must name every rule exactly once").toEqual(
        SHIFT_WRITE_RULES.map((rule) => `${rule}Rule`),
      );
    });

    it("the JArbSchG rule is called once, inside the gate module", () => {
      expect(checkCallCount(abs, source, CHECK_FUNCTION)).toBe(1);
    });
  });

  it("the Phorest sync calls the JArbSchG report exactly once, after every Shift write", () => {
    const abs = join(REPO_ROOT, PHOREST_SYNC);
    const source = readFileSync(abs, "utf8");
    expect(
      checkCallCount(abs, source, REPORT_FUNCTION),
      "the Phorest writes are 'reported': the end-of-run report must be called once (Issue #1074)",
    ).toBe(1);
    const { named, shiftWrites } = callPositions(abs, source, REPORT_FUNCTION);
    expect(shiftWrites.length, "no Shift write found in sync-shifts.ts").toBeGreaterThan(0);
    for (const write of shiftWrites) {
      expect(
        named[0],
        "the report must read the final week: it has to come after every Shift write",
      ).toBeGreaterThan(write);
    }
  });
});
