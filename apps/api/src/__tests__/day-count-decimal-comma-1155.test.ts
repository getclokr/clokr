/**
 * Issue #1155 - guard: a day count in an API text never prints a decimal point ("0.5 Tage").
 *
 * A half day is a real value (Berufsschul-Halbtage, a § 9 credit, a half leave day), so a text that
 * interpolates a day count in a template literal - `${days} Tage`, `${n} Tag(e)`, `Max. ${x} Tage/Jahr` -
 * must route the number through `fmtDays` / `fmtDecimalDe` of `apps/api/src/utils/number-de.ts`
 * (decimal comma, no trailing zeros), never print the JavaScript number itself ("0.5").
 *
 * Pure static analysis with the `typescript` package, over every production file under `src/`: a
 * template-literal span whose NEXT literal text starts with a day word (`Tag`, `Tage`, `Tagen`,
 * `Tag(e)`) is a finding unless the interpolated expression is a call of a registered German number
 * formatter, or SAFE_COUNTS names `file::expression` as a count that is a whole number by
 * construction (an array length, a configured integer limit). A stale SAFE_COUNTS entry fails, so
 * the register cannot rot into a blanket exemption.
 *
 * Stated blind spots: a day count joined with `+` / `concat` instead of a template literal; a day
 * word that is not directly behind the interpolation (`${n} bereits genutzte Tage`).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it, expect } from "vitest";
import { fmtDays, fmtDecimalDe } from "../utils/number-de";

const SRC = join(__dirname, "..");

/** Callee names whose result is already a German day count text. */
const GERMAN_NUMBER_FORMATTERS = new Set(["fmtDays", "fmtDecimalDe"]);

/** The day word right behind an interpolation: " Tage", " Tag(e)", "-Tage-Frist" is NOT one. */
const DAY_WORD_AFTER = /^\s*Tag(e|en)?\b/;

/**
 * "file::expression" -> reason: a whole number by construction, or text that already carries the
 * decimal comma, so no decimal point can print.
 */
const SAFE_COUNTS: Record<string, string> = {
  "contexts/absence/leave-request-create.ts::leadTimeDays": "a configured whole number of days",
  "contexts/absence/leave-request-create.ts::leaveType.maxDaysPerYear":
    "the configured whole-number yearly cap of a leave type",
  "contexts/absence/leave-request-create.ts::Number(rule.defaultDays)":
    "the whole-number day cap of a special-leave rule",
  "contexts/absence/api/leave.ts::existing.leaveType.maxDaysPerYear":
    "the configured whole-number yearly cap of a leave type",
  "contexts/absence/api/leave.ts::CALENDAR_RANGE_MAX_DAYS": "a constant whole number",
  "contexts/absence/api/leave-limits.ts::LEAVE_LIMIT_LOAD_MAX_DAYS": "a constant whole number",
  "contexts/platform/api/operator/support.ts::AUDIT_MAX_WINDOW_DAYS": "a constant whole number",
  "contexts/time-tracking/plugins/attendance-checker.ts::dayThreshold":
    "a configured whole number of days",
  "composition/data-retention.ts::minRetentionDays": "a configured whole number of days",
  "contexts/scheduling/minor-shift-limits.ts::days": "a count of planned days in a week",
  "contexts/absence/leave-days.ts::usedText": "already the fmtDecimalDe text of the used days",
  "contexts/absence/leave-days.ts::entitledText":
    "already the fmtDecimalDe text of the entitlement",
  "contexts/absence/vacation-calc.ts::formatted":
    "toLocaleString('de-DE') text (decimal comma); the file must stay a zero-import leaf (Issue #435)",
  "utils/number-de.ts::text": "the already formatted decimal-comma text of fmtDecimalDe",
  "contexts/working-time-account/api/overtime.ts::gaps.length": "the length of an array of days",
  "contexts/working-time-account/api/overtime.ts::unconfirmedBreakDays.length":
    "the length of an array of days",
  "contexts/working-time-account/api/overtime.ts::n": "a count of days with a break finding",
};

interface Finding {
  key: string;
  line: number;
}

function formatterName(expr: ts.Expression): string | null {
  if (!ts.isCallExpression(expr)) return null;
  const callee = expr.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

function scanSource(text: string, rel: string, used?: Set<string>): Finding[] {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const out: Finding[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) {
        if (!DAY_WORD_AFTER.test(span.literal.text)) continue;
        // A wrapped call (`Number(x)`, `String(x)`) is the number itself: only a German number
        // formatter makes it safe.
        const name = formatterName(span.expression);
        if (name && GERMAN_NUMBER_FORMATTERS.has(name)) continue;
        const key = `${rel}::${span.expression.getText(sf)}`;
        if (key in SAFE_COUNTS) {
          used?.add(key);
          continue;
        }
        const { line } = sf.getLineAndCharacterOfPosition(span.expression.getStart(sf));
        out.push({ key, line: line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function walk(dir: string, rel = "", out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const next = rel ? `${rel}/${name}` : name;
    if (statSync(join(dir, name)).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(join(dir, name), next, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(next);
    }
  }
  return out;
}

describe("a day count in an API text never prints a decimal point (Issue #1155)", () => {
  const files = walk(SRC);
  const used = new Set<string>();
  const findings = files.flatMap((rel) =>
    scanSource(readFileSync(join(SRC, rel), "utf8"), rel, used).map((f) => ({ ...f, rel })),
  );

  // Positive controls: the scanner sees what it must see (anti-vacuity).
  it("flags a raw number before a day word", () => {
    expect(scanSource("const t = `Resturlaub ${days} Tage`;", "x.ts").map((f) => f.key)).toEqual([
      "x.ts::days",
    ]);
    expect(scanSource("const t = `${Number(d)} Tag(e) gutgeschrieben`;", "x.ts")).toHaveLength(1);
    expect(scanSource("const t = `(neu: ${String(n)} Tage).`;", "x.ts")).toHaveLength(1);
    expect(scanSource("const t = `+${c.creditedDays} Tage gutgeschrieben`;", "x.ts")).toHaveLength(
      1,
    );
  });

  it("accepts the German number formatters and ignores a non-day word", () => {
    expect(scanSource("const t = `${fmtDecimalDe(days)} Tage`;", "x.ts")).toEqual([]);
    expect(scanSource("const t = `+${fmtDays(days)} gutgeschrieben`;", "x.ts")).toEqual([]);
    expect(scanSource("const t = `${n} Tageskarten`;", "x.ts")).toEqual([]);
    expect(scanSource("const t = `${n} Tag-Stunden`;", "x.ts")).toHaveLength(1);
  });

  it("walks a non-trivial tree", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("no production text interpolates a raw day count before a day word", () => {
    expect(
      findings.map(
        (f) => `${f.rel}:${f.line} \${${f.key.split("::")[1]}} - use fmtDays / fmtDecimalDe`,
      ),
    ).toEqual([]);
  });

  it("every SAFE_COUNTS entry is still met by the scan (a stale entry fails)", () => {
    expect(Object.keys(SAFE_COUNTS).filter((k) => !used.has(k))).toEqual([]);
  });

  it("the shared formatter prints the decimal comma (the value the guard routes to)", () => {
    expect(fmtDays(0.5)).toBe("0,5 Tage");
    expect(fmtDays(1)).toBe("1 Tag");
    expect(fmtDays(2.5)).toBe("2,5 Tage");
    expect(fmtDecimalDe(0.5)).toBe("0,5");
    expect(fmtDecimalDe(12)).toBe("12");
  });
});
