/**
 * Issue #1056 — the SHIFT_BASED roster Soll of the Arbeitszeitkonto nets with ONE break rule and
 * every production core call passes a real birth date.
 *
 * `CloseMonthInput.birthDate` is optional in the type only so the pure-core unit fixtures (the golden
 * files included) stay unchanged. A production caller that forgot it would silently net a minor's
 * roster with the adult break, so this gate walks every non-test source file under `apps/api/src` and
 * requires:
 *
 *  1. every `closeEmployeeMonth({ ... })` object literal names `birthDate` — as a property, as a
 *     shorthand, or through a spread of a same-file `const X = { ... }` that names it;
 *  2. a literal `null` / `undefined` value is allowed in exactly ONE call: `monthlyHoursMonthSollMinutes`
 *     (MONTHLY_HOURS only, `shifts: []`, so the roster break is never read);
 *  3. `rosterShiftBreakMinutes(` is called exactly once in each of `close-employee-month.ts`,
 *     `month-saldo.ts` and `overtime-balance.ts`, and in no other production file;
 *  4. inside `contexts/working-time-account/` the only `breakAmountFor(` call is the one in
 *     `rosterShiftBreakMinutes` (`close-employee-month.ts`).
 *
 * Comments are never scanned (TypeScript AST). Named blind spots: a call through an alias
 * (`const f = rosterShiftBreakMinutes; f(...)`), and a spread whose object is declared in ANOTHER
 * file. Both would be noticed in review as an unusual import or an unresolvable spread.
 *
 * Measured 2026-11-25 on origin/main + this change: 11 `closeEmployeeMonth({` call sites in
 * production code (close-employee-month.ts 4, month-saldo.ts 2, overtime-balance.ts 2,
 * auto-close-month.ts 1, recalculate-snapshots.ts 1, api/overtime.ts 1) and 349 production files
 * walked (floor in MIN_WALKED_FILES, about 85 %). The scripts under `apps/api/scripts` are outside
 * this walk; `backfill-month-snapshots.ts` passes `birthDate` by hand (D-10), the frozen one-shot
 * scripts stay on their historical adult rule on purpose.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { describe, it, expect } from "vitest";
import * as ts from "typescript";

// __dirname is apps/api/src/__tests__ — four levels up is the repo root.
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const SRC_DIR = join(REPO_ROOT, "apps/api/src");
const MIN_WALKED_FILES = 295;
const MIN_CORE_CALLS = 11;

const ROSTER_BREAK_CALLERS: Record<string, number> = {
  "apps/api/src/contexts/working-time-account/close-employee-month.ts": 1,
  "apps/api/src/contexts/working-time-account/month-saldo.ts": 1,
  "apps/api/src/contexts/working-time-account/overtime-balance.ts": 1,
};
const BREAK_AMOUNT_FOR_CALLERS_IN_KONTO: Record<string, number> = {
  "apps/api/src/contexts/working-time-account/close-employee-month.ts": 1,
};
const NULL_BIRTHDATE_ALLOWED_IN = "monthlyHoursMonthSollMinutes";

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

function namesBirthDate(literal: ts.ObjectLiteralExpression): {
  named: boolean;
  nullLiteral: boolean;
} {
  let named = false;
  let nullLiteral = false;
  for (const prop of literal.properties) {
    if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === "birthDate") named = true;
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === "birthDate"
    ) {
      named = true;
      const init = prop.initializer;
      if (
        init.kind === ts.SyntaxKind.NullKeyword ||
        (ts.isIdentifier(init) && init.text === "undefined")
      ) {
        nullLiteral = true;
      }
    }
  }
  return { named, nullLiteral };
}

interface CoreCall {
  named: boolean;
  nullLiteral: boolean;
  enclosingFunction: string | null;
}

/** Every `closeEmployeeMonth({ ... })` literal of a source text, with what it says about `birthDate`. */
function scanCoreCalls(fileName: string, source: string): CoreCall[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  // Same-file `const X = { ... }` object literals, for spread resolution.
  const consts = new Map<string, ts.ObjectLiteralExpression>();
  const collect = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      consts.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);

  const calls: CoreCall[] = [];
  const visit = (node: ts.Node, fn: string | null): void => {
    const here = ts.isFunctionDeclaration(node) && node.name ? node.name.text : fn;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "closeEmployeeMonth" &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const literal = node.arguments[0];
      let { named, nullLiteral } = namesBirthDate(literal);
      if (!named) {
        for (const prop of literal.properties) {
          if (ts.isSpreadAssignment(prop) && ts.isIdentifier(prop.expression)) {
            const target = consts.get(prop.expression.text);
            if (target) {
              const r = namesBirthDate(target);
              if (r.named) {
                named = true;
                nullLiteral = nullLiteral || r.nullLiteral;
              }
            }
          }
        }
      }
      calls.push({ named, nullLiteral, enclosingFunction: here });
    }
    ts.forEachChild(node, (child) => visit(child, here));
  };
  visit(sf, null);
  return calls;
}

/** Number of CallExpressions whose callee is the identifier `name`. */
function callCount(fileName: string, source: string, name: string): number {
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

describe("Issue #1056 — roster break rule and birthDate threading", () => {
  const files = walkTs(SRC_DIR);
  const sources = new Map(files.map((abs) => [repoRel(abs), readFileSync(abs, "utf8")]));

  const coreCalls: Array<CoreCall & { file: string }> = [];
  const rosterBreakCounts = new Map<string, number>();
  const breakAmountForInKonto = new Map<string, number>();
  for (const [file, source] of sources) {
    for (const call of scanCoreCalls(file, source)) coreCalls.push({ ...call, file });
    const r = callCount(file, source, "rosterShiftBreakMinutes");
    if (r > 0) rosterBreakCounts.set(file, r);
    if (file.startsWith("apps/api/src/contexts/working-time-account/")) {
      const b = callCount(file, source, "breakAmountFor");
      if (b > 0) breakAmountForInKonto.set(file, b);
    }
  }

  it("the walk sees the tree (a silently-empty walk would pass forever)", () => {
    expect(files.length, "no production file walked at all").toBeGreaterThan(0);
    expect(
      files.length,
      "fewer files walked than the measured floor — the scan root moved or emptied",
    ).toBeGreaterThanOrEqual(MIN_WALKED_FILES);
    for (const file of [
      ...Object.keys(ROSTER_BREAK_CALLERS),
      "apps/api/src/contexts/working-time-account/plugins/auto-close-month.ts",
      "apps/api/src/contexts/working-time-account/recalculate-snapshots.ts",
      "apps/api/src/contexts/working-time-account/api/overtime.ts",
    ]) {
      expect(sources.has(file), `the walk did not reach ${file} (moved or renamed)`).toBe(true);
    }
    expect(
      coreCalls.length,
      "fewer closeEmployeeMonth call sites than measured — a caller was lost or the scan broke",
    ).toBeGreaterThanOrEqual(MIN_CORE_CALLS);
  });

  it("positive controls: an unnamed literal is flagged, a shorthand and a spread count, a comment is ignored", () => {
    const flagged = scanCoreCalls("x.ts", `closeEmployeeMonth({ employeeId, tz });`);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.named).toBe(false);

    expect(scanCoreCalls("x.ts", `closeEmployeeMonth({ employeeId, birthDate });`)[0]!.named).toBe(
      true,
    );
    expect(
      scanCoreCalls(
        "x.ts",
        `const shared = { birthDate: e.birthDate ?? null };\ncloseEmployeeMonth({ ...shared, tz });`,
      )[0]!.named,
    ).toBe(true);
    // A spread of an object that does NOT name it does not count.
    expect(
      scanCoreCalls("x.ts", `const shared = { tz };\ncloseEmployeeMonth({ ...shared });`)[0]!.named,
    ).toBe(false);
    // A comment is not a property.
    expect(
      scanCoreCalls("x.ts", `closeEmployeeMonth({ employeeId /* birthDate */ });`)[0]!.named,
    ).toBe(false);
    // A literal null is recognised (and then only allowed in the MONTHLY_HOURS helper).
    const nulled = scanCoreCalls("x.ts", `closeEmployeeMonth({ birthDate: null });`)[0]!;
    expect(nulled.named && nulled.nullLiteral).toBe(true);
    // An expression ending in `?? null` is a real value, not a literal null.
    expect(
      scanCoreCalls("x.ts", `closeEmployeeMonth({ birthDate: emp.birthDate ?? null });`)[0]!
        .nullLiteral,
    ).toBe(false);

    expect(
      callCount("x.ts", `rosterShiftBreakMinutes(a, b, c, d);`, "rosterShiftBreakMinutes"),
    ).toBe(1);
    expect(
      callCount(
        "x.ts",
        `// rosterShiftBreakMinutes(a)\nconst s = "rosterShiftBreakMinutes(";\nimport { rosterShiftBreakMinutes } from "./x";`,
        "rosterShiftBreakMinutes",
      ),
    ).toBe(0);
  });

  it("every production closeEmployeeMonth call names birthDate", () => {
    expect(
      coreCalls.filter((c) => !c.named).map((c) => c.file),
      "a production core call without birthDate nets a minor's roster with the adult break (Issue #1056)",
    ).toEqual([]);
  });

  it("a literal null/undefined birthDate exists only in monthlyHoursMonthSollMinutes", () => {
    const nulls = coreCalls.filter((c) => c.nullLiteral);
    expect(nulls.map((c) => c.enclosingFunction)).toEqual([NULL_BIRTHDATE_ALLOWED_IN]);
    expect(nulls.map((c) => c.file)).toEqual([
      "apps/api/src/contexts/working-time-account/close-employee-month.ts",
    ]);
  });

  it("rosterShiftBreakMinutes is called once in each Arbeitszeitkonto closure and nowhere else", () => {
    expect(
      Object.fromEntries([...rosterBreakCounts].sort(([a], [b]) => a.localeCompare(b))),
    ).toEqual(ROSTER_BREAK_CALLERS);
  });

  it("inside Arbeitszeitkonto the only breakAmountFor call is the one in rosterShiftBreakMinutes", () => {
    expect(Object.fromEntries([...breakAmountForInKonto])).toEqual(
      BREAK_AMOUNT_FOR_CALLERS_IN_KONTO,
    );
  });
});
