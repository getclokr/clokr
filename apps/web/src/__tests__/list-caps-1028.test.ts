// Issue #1028 - no new hard-coded list cap in a route or an area component, and every list that pages
// has a stored id.
//
// The rule: a list shows every row it has, paged by the shared list block (`ListWidget`, `Pager`,
// `DataTable`), with the size a person chose. A cut at a fixed number - `{#each rows.slice(0, 5)}`,
// `.slice(0, SHOWN)`, a literal `?limit=8` read, a „N weitere“ summary line - hides rows nobody can
// reach. Before #1028 there were ten of them (Heute im Salon, Mein Tag, Monatsabschluss, Team ›
// Aufgaben, the saldo card, the export history, the import preview, ...); this guard fails on a new one.
//
// What this guard sees, in every `.svelte` and `.ts` file under `src/routes` and `src/lib` (the block
// itself `lib/components/ui/`, `lib/lists/` and every test are outside the walk; HTML, block and line
// comments and `<style>` are stripped first, so a comment can exempt nothing):
//   (1) an `{#each` whose iterable contains `.slice(`;
//   (2) `.slice(0, X)` / `.slice(-X)` with an UPPER_SNAKE name;
//   (3) `.slice(0, n)` / `.slice(-n)` with a numeric literal other than 2, 4, 7, 10 (initials, year,
//       year-month, ISO day - string slices, never a list cap);
//   (4) a literal `limit=` / `take=` / `pageSize=` number in a string or template (a read bound);
//   (5) a count directly before „weitere“, „weiterer“, „weiteren“ (a `}` of an interpolation or a digit).
// Every hit that is NOT a list cap is registered in `CAP_EXCEPTIONS` with its reason; counts are exact,
// so a new hit AND a stale entry both fail. A cap of exactly 2, 4, 7 or 10 is a documented blind spot
// (a review item). A computed bound (`.slice(0, limit)` with a lower-case name, `limit=${n}`) is not seen
// either: it is a decision of code, not a literal.
//
// The second half: a `<DataTable` or `<ListWidget` of the tenant app without `listId` fails, and every
// literal `listId="..."` must be an id of `packages/types/list-preferences.json`. Named exemptions:
// `lib/components/operator/` (the operator console stores nothing, P-12), the operator routes and the
// bausteine demos.
//
// Each detector is proven on in-memory fixtures (a plant that fails and a control that passes), and the
// walks state a floor, so a moved directory turns the guard red instead of vacuously green.
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import register from "@clokr/types/list-preferences.json";

import { SRC_ROOT, walkFiles, type SourceFile } from "./design-source-files";

// ── the detectors ────────────────────────────────────────────────────────────

export type Detector = "each-slice" | "slice-const" | "slice-literal" | "read-bound" | "weitere";

/** HTML comments, block comments, line comments and `<style>` blocks removed (strings keep their `//`). */
export function stripComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

const IGNORED_SLICE_WIDTHS = new Set([2, 4, 7, 10]);

/** Every cap this file spells, as detector names (one entry per occurrence). */
export function capHits(text: string): Detector[] {
  const s = stripComments(text);
  const hits: Detector[] = [];
  for (const m of s.matchAll(/\{#each\s+([\s\S]{0,400}?)\s+as\s/g)) {
    if (m[1].includes(".slice(")) hits.push("each-slice");
  }
  for (const m of s.matchAll(/\.slice\(\s*(?:0\s*,\s*|-\s*)([A-Z][A-Z0-9_]*[A-Z0-9])\s*\)/g)) {
    hits.push("slice-const");
    void m;
  }
  for (const m of s.matchAll(/\.slice\(\s*(?:0\s*,\s*|-\s*)(\d+)\s*\)/g)) {
    if (!IGNORED_SLICE_WIDTHS.has(Number(m[1]))) hits.push("slice-literal");
  }
  for (const m of s.matchAll(/[?&](?:limit|take|pageSize)=\d+/g)) {
    hits.push("read-bound");
    void m;
  }
  for (const m of s.matchAll(/[}\d]\s*weitere[rn]?\b/g)) {
    hits.push("weitere");
    void m;
  }
  return hits;
}

// ── the register of reasoned exceptions ─────────────────────────────────────

interface CapException {
  file: string;
  detector: Detector;
  /** Exactly how many hits of this detector the file has. */
  count: number;
  reason: string;
}

/**
 * Every hit that is not a list cap, or a cap that is deliberate and says why. A new hit is a finding
 * (switch it to the block); a new entry needs a reason a reviewer can check.
 */
export const CAP_EXCEPTIONS: readonly CapException[] = [
  {
    file: "lib/team/salon-hours.ts",
    detector: "slice-const",
    count: 1,
    reason:
      "Issue #1030: MAX_ELSEWHERE_NAMES spells out at most two salon names inside one cell chip of the Salonansicht and counts the rest as „+N“ („in Süd, Ost +1“); it is a chip text of one day cell, not a list.",
  },
  {
    file: "lib/components/breaks/DayCheckLine.svelte",
    detector: "weitere",
    count: 1,
    reason:
      "L9: the day-check line above Team › Zeiten is ONE sentence (#1029), not a list widget; its „N weitere“ is a button that opens the full list view.",
  },
  {
    file: "lib/components/reports/ExitedFinalSaldoSection.svelte",
    detector: "weitere",
    count: 2,
    reason:
      "L15: the server bounds the table (it computes a saldo per person, #613); „und N weitere“ is a link to Verwalten › Personen (status alle) for a reader who may open it, plain text otherwise - the same line in two branches.",
  },
  {
    file: "lib/components/employees/detail/VertragTab.svelte",
    detector: "weitere",
    count: 1,
    reason:
      "L16: the orphan-shift preview sits inside a confirmation dialog whose decision names the full count; the preview is a sample, not a list to browse.",
  },
  {
    file: "routes/(app)/admin/audit/+page.svelte",
    detector: "weitere",
    count: 1,
    reason:
      "L17: the change summary of ONE Protokoll row („+ N weitere“ changed fields); the row opens the detail page with every field.",
  },
  {
    file: "lib/team/task-row-facts.ts",
    detector: "weitere",
    count: 1,
    reason:
      "L18: the sentence „auch abwesend: A, B und N weitere“ on a task row is one context line, not a list.",
  },
  {
    file: "lib/team/task-row-facts.ts",
    detector: "slice-const",
    count: 1,
    reason:
      "L18: NAMED_COLLEAGUES names at most that many colleagues in the same one-sentence context line.",
  },
  {
    file: "lib/breaks/day-break-violation.ts",
    detector: "slice-literal",
    count: 1,
    reason:
      "L19: the break chip's title names the first three dates and „(+N weitere)“; it is a tooltip sentence, the days are listed in the Monatsabschluss.",
  },
  {
    file: "lib/breaks/day-break-violation.ts",
    detector: "weitere",
    count: 1,
    reason: "L19: the „(+N weitere)“ of the same chip title sentence.",
  },
  {
    file: "lib/month-close/day-lists.ts",
    detector: "slice-literal",
    count: 1,
    reason:
      "L20: the Monatsabschluss gap-day sentence names three dates and „(+N)“; the full list sits in the month dialog.",
  },
  {
    file: "routes/(app)/dashboard/+page.svelte",
    detector: "read-bound",
    count: 1,
    reason:
      "P-08: the `/activity` read of 20 is the API's maximum for the Verlauf feed; the widget pages everything that was read.",
  },
  {
    file: "routes/(app)/admin/export/+page.svelte",
    detector: "read-bound",
    count: 1,
    reason:
      "L13: the `/audit-logs` EXPORT read of 200 is the API's maximum page; every row read is pageable in „Letzte Exporte“.",
  },
  {
    file: "routes/(app)/admin/availability/+page.svelte",
    detector: "read-bound",
    count: 1,
    reason:
      "L22: the `/employees` read of 500 is the read bound of a person picker, not a list cap.",
  },
  {
    file: "routes/(app)/admin/shutdowns/[id]/+page.svelte",
    detector: "read-bound",
    count: 1,
    reason:
      "L22: the `/employees` read of 500 is the read bound of a person picker, not a list cap.",
  },
  {
    file: "lib/components/admin/phorest/PhorestConnectionPanel.svelte",
    detector: "read-bound",
    count: 1,
    reason:
      "L22: the `/employees` read of 500 is the read bound of a person picker, not a list cap.",
  },
  {
    file: "routes/(app)/shifts/+page.svelte",
    detector: "slice-literal",
    count: 4,
    reason: "HH:mm of a time string (`startTime.slice(0, 5)`), four times - never a list.",
  },
  {
    file: "routes/(auth)/otp/+page.svelte",
    detector: "slice-literal",
    count: 1,
    reason: "The six-digit one-time code input (`.slice(0, 6)`).",
  },
  {
    file: "lib/components/operator/SignInSteps.svelte",
    detector: "slice-literal",
    count: 1,
    reason: "The six-digit one-time code input of the operator sign-in (`.slice(0, 6)`).",
  },
  {
    file: "lib/export/export-centre.ts",
    detector: "slice-literal",
    count: 1,
    reason: "The day label „01.09.“ of a period (`dayLabel(from).slice(0, 6)`).",
  },
  {
    file: "lib/operator/slug.ts",
    detector: "slice-const",
    count: 1,
    reason: "`SLUG_MAX` is the maximum length of a tenant slug string, not a row count.",
  },
  {
    file: "lib/leave/team-leave-model.ts",
    detector: "slice-literal",
    count: 1,
    reason: "`.split(...).slice(-1)[0]` takes the last word of a name (the last name).",
  },
];

/**
 * Caps and cuts the detectors cannot see (a bound passed to a helper, a literal inside a template that no
 * pattern names). Each is pinned by a needle that must still occur in the file, so a removed or renamed
 * one turns this entry stale instead of leaving a false claim.
 */
export const UNSEEN_CAPS: readonly { file: string; needle: string; reason: string }[] = [
  {
    file: "lib/breaks/day-check-line.ts",
    needle: "DAY_CHECK_LINE_NAMED_DAYS = 5",
    reason:
      "L9: the day-check line names the five newest days in ONE sentence; its own named constant (not the retired #987 cap), the „N weitere“ button opens the full list view (#1029).",
  },
  {
    file: "lib/month-close/day-lists.ts",
    needle: "(+${dates.length - 3})",
    reason:
      "L20: the Monatsabschluss gap-day sentence „03.10., 04.10., 05.10. (+N)“; one sentence.",
  },
];

// ── the walk ─────────────────────────────────────────────────────────────────

const EXCLUDED_PREFIXES = ["lib/components/ui/", "lib/lists/"];

function relToSrc(file: SourceFile, root: string): string {
  return `${root}/${file.rel}`;
}

function scannedFiles(): { rel: string; text: string }[] {
  const files: { rel: string; text: string }[] = [];
  for (const root of ["routes", "lib"]) {
    for (const f of walkFiles(join(SRC_ROOT, root), [".svelte", ".ts"], { includeTests: false })) {
      const rel = relToSrc(f, root);
      if (EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
      files.push({ rel, text: f.text });
    }
  }
  return files;
}

function tally(files: { rel: string; text: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of files) {
    for (const detector of capHits(f.text)) {
      const key = `${f.rel} | ${detector}`;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
  }
  return out;
}

// ── listId rule ──────────────────────────────────────────────────────────────

/** Index after the `}` that closes the `{` at `i`; aware of quotes and template literals. */
function skipBraces(s: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < s.length) {
    const c = s[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < s.length && s[i] !== c) {
        if (s[i] === "\\") i++;
        i++;
      }
    } else if (c === "`") {
      i++;
      while (i < s.length && s[i] !== "`") {
        if (s[i] === "\\") i++;
        else if (s[i] === "$" && s[i + 1] === "{") i = skipBraces(s, i + 1) - 1;
        i++;
      }
    }
    i++;
  }
  return i;
}

/** The start tags (attribute source) of `<DataTable` and `<ListWidget` in the template. */
export function listTags(text: string): { component: string; source: string }[] {
  const s = stripComments(text).replace(/<script[\s\S]*?<\/script>/g, "");
  const out: { component: string; source: string }[] = [];
  for (const m of s.matchAll(/<(DataTable|ListWidget)(?=[\s/>])/g)) {
    let i = m.index + m[0].length;
    const begin = i;
    while (i < s.length) {
      const c = s[i];
      if (c === ">") break;
      if (c === "{") {
        i = skipBraces(s, i);
        continue;
      }
      if (c === '"' || c === "'") {
        i++;
        while (i < s.length && s[i] !== c) i++;
      }
      i++;
    }
    out.push({ component: m[1], source: s.slice(begin, i) });
  }
  return out;
}

export function hasListId(source: string): boolean {
  return /(?:^|\s)listId\s*=|\{\s*listId\s*\}/.test(source);
}

export function literalListIds(source: string): string[] {
  return [...source.matchAll(/(?:^|\s)listId\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(
    (m) => m[1] ?? m[2],
  );
}

const LIST_ID_EXEMPT = [
  "lib/components/operator/",
  "routes/(operator)/",
  "routes/(app)/admin/bausteine/",
];

const registered = new Set(Object.keys(register.lists));

// ── tests ────────────────────────────────────────────────────────────────────

describe("the detectors see a planted cap (Issue #1028)", () => {
  it.each([
    ["{#each rows.slice(0, 3) as r}", "each-slice"],
    ["{#each (items ?? []).slice(0, limit) as r (r.id)}", "each-slice"],
    ["const shown = rows.slice(0, MAX_ROWS);", "slice-const"],
    ["const last = rows.slice(-SHOWN);", "slice-const"],
    ["const first = rows.slice(0, 12);", "slice-literal"],
    ['await api.get("/x?limit=9");', "read-bound"],
    ["await api.get(`/x?a=1&take=15`);", "read-bound"],
    ["<li>und {more} weitere</li>", "weitere"],
    ["<li>… und 3 weitere Tage</li>", "weitere"],
  ] as [string, Detector][])("fails on %s", (source, detector) => {
    expect(capHits(source)).toContain(detector);
  });

  it.each([
    ["const day = iso.slice(0, 10);"],
    ["const ym = value.slice(0, 7);"],
    ["const initials = name.slice(0, 2);"],
    ["const year = date.slice(0, 4);"],
    ["const n = rows.slice(0, limit);"],
    ["await api.get(`/x?limit=${size}`);"],
    ["<p>Das gilt für weitere Personen.</p>"],
    ["// rows.slice(0, 5) in a comment\nconst a = 1;"],
    ["<!-- {#each rows.slice(0, 5) as r} -->"],
  ])("passes the control %s", (source) => {
    expect(capHits(source)).toEqual([]);
  });

  it("a comment cannot exempt a planted cap that stays in code", () => {
    expect(capHits("const x = rows.slice(0, 3); // reason: harmless")).toEqual(["slice-literal"]);
  });
});

describe("the listId rule sees a table or widget without a stored id (Issue #1028)", () => {
  it("finds the start tags and their attributes", () => {
    const tags = listTags(
      `<DataTable listId="verwalten.rollen.rollen" rows={rows.filter((r) => r.a > 1)}>x</DataTable>\n<ListWidget title="T" items={a}>y</ListWidget>`,
    );
    expect(tags.map((t) => t.component)).toEqual(["DataTable", "ListWidget"]);
    expect(hasListId(tags[0].source)).toBe(true);
    expect(hasListId(tags[1].source)).toBe(false);
  });

  it("accepts the shorthand and a prop spread of the id", () => {
    expect(hasListId(" {listId} rows={rows}")).toBe(true);
    expect(hasListId(" listId={id} rows={rows}")).toBe(true);
  });

  it("reads literal ids and ignores a computed one", () => {
    expect(literalListIds(' listId="a.b.c" x="1"')).toEqual(["a.b.c"]);
    expect(literalListIds(" listId={id}")).toEqual([]);
  });

  it("a `>` inside a braced attribute does not end the tag", () => {
    const [tag] = listTags('<DataTable rows={rows.filter((r) => r.n > 1)} listId="a.b" />');
    expect(hasListId(tag.source)).toBe(true);
  });
});

describe("no hard-coded list cap outside the register (Issue #1028)", () => {
  const files = scannedFiles();

  it("[vacuity] walks the routes and the area components", () => {
    expect(files.length).toBeGreaterThan(300);
    expect(files.some((f) => f.rel.startsWith("routes/(app)/dashboard/"))).toBe(true);
    expect(files.some((f) => f.rel.startsWith("lib/components/admin/"))).toBe(true);
    expect(files.some((f) => f.rel.startsWith("lib/components/ui/"))).toBe(false);
  });

  it("every hit is registered with its exact count, and every entry still matches", () => {
    const found = tally(files);
    const expected = new Map(CAP_EXCEPTIONS.map((e) => [`${e.file} | ${e.detector}`, e.count]));
    const unregistered = [...found]
      .filter(([key, n]) => expected.get(key) !== n)
      .map(
        ([key, n]) =>
          `${key} x${n}${expected.has(key) ? ` (register says ${expected.get(key)})` : ""}`,
      );
    const stale = [...expected].filter(([key]) => !found.has(key)).map(([key]) => key);
    expect({ unregistered, stale }).toEqual({ unregistered: [], stale: [] });
  });

  it("every register entry names a reason and a positive count", () => {
    for (const e of CAP_EXCEPTIONS) {
      expect(e.reason.trim().length, `${e.file} | ${e.detector}`).toBeGreaterThan(20);
      expect(e.count).toBeGreaterThan(0);
    }
    const keys = CAP_EXCEPTIONS.map((e) => `${e.file} | ${e.detector}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the caps no detector sees stay true (Issue #1028)", () => {
  const files = scannedFiles();

  it.each(UNSEEN_CAPS)("$file still carries $needle", ({ file, needle, reason }) => {
    const found = files.find((f) => f.rel === file);
    expect(found, `${file} is no longer in the walk`).toBeDefined();
    expect(found?.text.includes(needle), reason).toBe(true);
    expect(reason.trim().length).toBeGreaterThan(20);
  });
});

describe("every table and widget of the tenant app has a stored id (Issue #1028)", () => {
  const files = scannedFiles().filter((f) => !LIST_ID_EXEMPT.some((p) => f.rel.startsWith(p)));
  const tags = files.flatMap((f) => listTags(f.text).map((t) => ({ ...t, rel: f.rel })));

  it("[vacuity] finds the tables and widgets of the tenant app", () => {
    expect(tags.filter((t) => t.component === "DataTable").length).toBeGreaterThan(40);
    expect(tags.filter((t) => t.component === "ListWidget").length).toBeGreaterThan(5);
  });

  it("every `<DataTable` and `<ListWidget` carries a listId", () => {
    const missing = tags.filter((t) => !hasListId(t.source)).map((t) => `${t.rel} <${t.component}`);
    expect(missing).toEqual([]);
  });

  it("every literal listId is an id of the register", () => {
    const unknown = tags
      .flatMap((t) => literalListIds(t.source).map((id) => ({ id, rel: t.rel })))
      .filter(({ id }) => !registered.has(id))
      .map(({ id, rel }) => `${rel}: ${id}`);
    expect(unknown).toEqual([]);
  });

  it("a Pagination outside a DataTable of the tenant app names its listId too", () => {
    const missing = files
      .filter((f) => f.rel.endsWith(".svelte"))
      .flatMap((f) =>
        [...stripComments(f.text).matchAll(/<Pagination(?=[\s/>])([\s\S]*?)\/>/g)].map((m) => ({
          rel: f.rel,
          source: m[1],
        })),
      )
      .filter((t) => !hasListId(t.source))
      .map((t) => t.rel);
    expect(missing).toEqual([]);
  });
});
