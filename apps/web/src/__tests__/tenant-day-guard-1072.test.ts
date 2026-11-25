// Issue #1072 - no place of the web app names "today", the month or the year from the DEVICE clock
// or the UTC day. The server files every stamp under the TENANT's calendar day; a page that reads the
// device (or UTC) day is a day off at night and at New Year. The one way to say "today" is
// `tenantDay(new Date(), $tenantFeatures.timezone)` of `$lib/utils/tenant-day`.
//
// This is a source scan over every `.ts` / `.svelte` file of `apps/web/src` outside the tests, with
// controls that prove the scan can see: a corpus floor, a planted sample per rule (and planted
// negatives), the comment stripper, and a register whose entries must still hit.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TENANT_DAY_EXCEPTIONS, type TenantDayRule } from "./tenant-day-register";

/** `apps/web/src`; under jsdom `import.meta.url` is no file URL, so the working directory (apps/web) is used. */
function srcRoot(): string {
  try {
    return fileURLToPath(new URL("..", import.meta.url));
  } catch {
    return resolve(process.cwd(), "src");
  }
}

const SRC = srcRoot();

/** The seven rules (P-05 of the 1072 plan), JavaScript regexes over comment-stripped source. */
const RULES: ReadonlyArray<{ id: TenantDayRule; re: RegExp }> = [
  {
    id: "format-device-day",
    re: /format\(\s*(?:new Date\(\)|now|today)\s*,\s*["'`]yyyy-MM-dd["'`]\s*\)/g,
  },
  {
    id: "utc-day-of-now",
    re: /(?:new Date\(\)|\btoday|\bnow)\s*\.toISOString\(\)\s*\.(?:slice\(\s*0\s*,\s*10\s*\)|substring\(\s*0\s*,\s*10\s*\)|split\(\s*["'`]T["'`]\s*\))/g,
  },
  { id: "device-calendar-field", re: /new Date\(\)\s*\.get(?:FullYear|Month|Date|Day)\(\)/g },
  { id: "browser-day-helper", re: /\blocalCalendarDay\s*\(/g },
  { id: "device-default-param", re: /:\s*Date\s*=\s*new Date\(\)/g },
  {
    id: "day-helper-on-device-clock",
    re: /(?<![$\w])(?!(?:new|\$state|\$derived)\b)[A-Za-z_]\w*\(\s*new Date\(\)\s*\)/g,
  },
  {
    id: "now-calendar-field",
    re: /\b(?:now|today|currentDate)\s*\.get(?:FullYear|Month|Date|Day)\(\)/g,
  },
];

/**
 * Removes comments but keeps every newline, so a reported line number is the real one: `<!-- -->` and
 * `/* *\/` blocks become the newlines they contained, a full-line `//` comment becomes empty and a
 * trailing ` // ...` comment is cut.
 */
function stripComments(source: string): string {
  const keepNewlines = (m: string) => m.replace(/[^\n]/g, "");
  return source
    .replace(/<!--[\s\S]*?-->/g, keepNewlines)
    .replace(/\/\*[\s\S]*?\*\//g, keepNewlines)
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? "" : line.replace(/\s\/\/(?:\s.*)?$/, "")))
    .join("\n");
}

interface Hit {
  file: string;
  line: number;
  rule: TenantDayRule;
  match: string;
}

function scan(file: string, source: string): Hit[] {
  const text = stripComments(source);
  const hits: Hit[] = [];
  for (const { id, re } of RULES) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const line = text.slice(0, m.index).split("\n").length;
      hits.push({ file, line, rule: id, match: m[0] });
    }
  }
  return hits;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (
      /\.(?:ts|svelte)$/.test(entry.name) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

const FILES = walk(SRC).map((f) => relative(SRC, f).split(sep).join("/"));
const SOURCES = new Map(FILES.map((f) => [f, readFileSync(join(SRC, f), "utf8")]));
const ALL_HITS = FILES.flatMap((f) => scan(f, SOURCES.get(f) ?? ""));

describe("tenant-day guard (#1072)", () => {
  describe("controls", () => {
    it("corpus: the scan sees the app", () => {
      expect(FILES.length).toBeGreaterThanOrEqual(500);
      expect(FILES).toContain("routes/(app)/time-entries/+page.svelte");
      expect(FILES).toContain("lib/utils/tenant-day.ts");
      expect(FILES.some((f) => f.startsWith("routes/(operator)/"))).toBe(true);
    });

    const PLANTED: Array<[TenantDayRule, string]> = [
      ["format-device-day", 'const todayStr = format(today, "yyyy-MM-dd");'],
      ["utc-day-of-now", "return new Date().toISOString().slice(0, 10);"],
      ["utc-day-of-now", 'startDate: today.toISOString().split("T")[0],'],
      ["device-calendar-field", "const thisYear = new Date().getFullYear();"],
      ["browser-day-helper", "const today = localCalendarDay();"],
      ["device-default-param", "export function localDay(now: Date = new Date()): string {"],
      ["day-helper-on-device-clock", "const today = toLocalDateStr(new Date());"],
      ["now-calendar-field", "const year = now.getFullYear();"],
    ];
    const NEGATIVES = [
      "tenantDay(new Date(), zone)",
      "let currentTime = $state(new Date());",
      "new Date().getHours()",
      "todayDate.toISOString().slice(0, 10)",
      'format(new Date(selectedDate + "T12:00:00"), "EEEE")',
    ];

    for (const [rule, line] of PLANTED) {
      it(`matcher: ${rule} matches \`${line}\``, () => {
        expect(scan("planted.ts", line).map((h) => h.rule)).toContain(rule);
      });
    }

    it("matcher: every rule is planted at least once", () => {
      expect(new Set(PLANTED.map(([r]) => r))).toEqual(new Set(RULES.map((r) => r.id)));
    });

    for (const line of NEGATIVES) {
      it(`matcher: nothing matches \`${line}\``, () => {
        expect(scan("planted.ts", line)).toEqual([]);
      });
    }

    it("stripper: a banned call inside a comment disappears", () => {
      const banned = "new Date().getFullYear()";
      expect(scan("a.ts", `// ${banned}`)).toEqual([]);
      expect(scan("a.ts", `/* ${banned} */`)).toEqual([]);
      expect(scan("a.svelte", `<!-- ${banned} -->`)).toEqual([]);
      expect(scan("a.ts", `const x = 1; // ${banned}`)).toEqual([]);
    });

    it("stripper: a hit behind a multi-line block comment keeps its real line number", () => {
      const source = ["/*", " * one", " * two", " */", "const y = new Date().getFullYear();"].join(
        "\n",
      );
      expect(scan("a.ts", source).map((h) => h.line)).toEqual([5]);
    });

    it("register: every entry names a scanned file and a known rule, with a reason", () => {
      const ids = new Set(RULES.map((r) => r.id));
      const seen = new Set<string>();
      for (const e of TENANT_DAY_EXCEPTIONS) {
        expect(FILES, `${e.file} is not a scanned file`).toContain(e.file);
        expect(ids.has(e.rule), `${e.rule} is not a rule`).toBe(true);
        expect(e.reason.length, `${e.file} × ${e.rule}: reason too short`).toBeGreaterThanOrEqual(
          40,
        );
        const key = `${e.file} × ${e.rule}`;
        expect(seen.has(key), `${key} is listed twice`).toBe(false);
        seen.add(key);
      }
    });

    it("register: no entry is stale - its rule still hits that file", () => {
      for (const e of TENANT_DAY_EXCEPTIONS) {
        const stillHits = ALL_HITS.some((h) => h.file === e.file && h.rule === e.rule);
        expect(stillHits, `${e.file} × ${e.rule} no longer hits - remove the entry`).toBe(true);
      }
    });
  });

  it("no file reads today, the month or the year from the device or UTC clock", () => {
    const allowed = new Set(TENANT_DAY_EXCEPTIONS.map((e) => `${e.file} × ${e.rule}`));
    const offenders = ALL_HITS.filter((h) => !allowed.has(`${h.file} × ${h.rule}`)).map(
      (h) => `${h.file}:${h.line} ${h.rule} ${h.match}`,
    );
    expect(offenders).toEqual([]);
  });
});
