// Issue #1058 - the info-symbol rule is guarded (owner decision 24.11.2026, D-01 / D-02).
//
// The rule: a pure explanation takes no room - it sits behind an `InfoHint` beside the heading,
// label or value it explains. A deadline, lock, warning, error, legal consequence, the effect of the
// button about to be pressed or a state the person must act on stays visible text.
//
// What this guard sees: the LITERAL text a page passes to a description carrier.
//   - PageHead / PageHeader `sub` / `subtitle`  (the page subtitle under the H1, D-02),
//   - SettingsGroup `description` and admin `Section` `sub`  (a section text),
//   - FormField / ToggleField / WeekdayPicker `help`  (a field help) - these are not forbidden but
//     must be registered with the reason why they stay visible (`VISIBLE_HELP`).
// A new literal subtitle or section text fails, and so does a literal field help nobody has argued
// for. Each matcher is proven on in-memory fixtures (positive and negative controls) and every walk
// states a floor, so a moved directory or a renamed prop turns the guard red instead of vacuously green.
//
// What it does NOT see (these stay review items under the README rule, `ui/README.md`, section
// InfoHint): a computed or conditional text (`sub={headSentence}`, a ternary, a template literal with
// `${}`), a raw paragraph (`<p class="settings-group-desc">`, `.form-hint`) and a `Note`. A computed
// subtitle that carries data stays visible on purpose (P-04).
//
// Named exclusion: `lib/components/operator/` - operator console, outside the inventory (P-06). The
// signed-out pages and `routes/(operator)` are outside the walk.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SRC_ROOT, walkFiles, type SourceFile } from "./design-source-files";

// ── the matchers ─────────────────────────────────────────────────────────────

export const CARRIERS = [
  "PageHead",
  "PageHeader",
  "SettingsGroup",
  "Section",
  "FormField",
  "ToggleField",
  "WeekdayPicker",
] as const;
export type CarrierName = (typeof CARRIERS)[number];

export interface CarrierTag {
  component: CarrierName;
  /** attribute name -> raw value source (`"text"`, `{expr}`, or "" for a bare attribute). */
  attrs: Map<string, string>;
}

/** The template of a Svelte file: no comment, no script, no style. */
export function markupOf(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "");
}

/** Index after the `}` that closes the `{` at `i`; aware of quotes and template literals. */
function skipBraces(s: string, i: number): number {
  let depth = 0;
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

/** Every start tag of a carrier component in the template, brace- and quote-aware. */
export function carrierTags(text: string): CarrierTag[] {
  const s = markupOf(text);
  const out: CarrierTag[] = [];
  const re = /<([A-Z][A-Za-z0-9]*)(?=[\s/>])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const name = m[1] as CarrierName;
    if (!(CARRIERS as readonly string[]).includes(name)) continue;
    let i = m.index + m[0].length;
    const attrs = new Map<string, string>();
    while (i < s.length) {
      while (/\s/.test(s[i] ?? "")) i++;
      if (s[i] === ">") {
        i++;
        break;
      }
      if (s[i] === "/" && s[i + 1] === ">") {
        i += 2;
        break;
      }
      if (s[i] === "{") {
        i = skipBraces(s, i); // spread or shorthand attribute
        continue;
      }
      const nameStart = i;
      while (i < s.length && /[^\s=/>{]/.test(s[i])) i++;
      const attrName = s.slice(nameStart, i);
      let value = "";
      if (s[i] === "=") {
        i++;
        const valueStart = i;
        if (s[i] === '"' || s[i] === "'") {
          const q = s[i];
          i++;
          while (i < s.length && s[i] !== q) i++;
          i++;
        } else if (s[i] === "{") {
          i = skipBraces(s, i);
        } else {
          while (i < s.length && /[^\s>]/.test(s[i])) i++;
        }
        value = s.slice(valueStart, i);
      }
      if (attrName) attrs.set(attrName, value);
    }
    out.push({ component: name, attrs });
    re.lastIndex = Math.max(re.lastIndex, i);
  }
  return out;
}

/**
 * The literal text of an attribute value, or null when the value is computed: a quoted string
 * without `{`, `{"…"}`, `{'…'}` or a template literal without `${`. A ternary, an identifier and a
 * template literal with `${` are computed.
 */
export function literalText(raw: string | undefined): string | null {
  if (raw === undefined || raw === "") return null;
  let body: string | null = null;
  if (raw.startsWith('"') || raw.startsWith("'")) {
    const inner = raw.slice(1, -1);
    body = inner.includes("{") ? null : inner;
  } else if (raw.startsWith("{") && raw.endsWith("}")) {
    const inner = raw.slice(1, -1).trim();
    const str = inner.match(/^"([^"\\]*)"$/) ?? inner.match(/^'([^'\\]*)'$/);
    const tpl = inner.match(/^`([^`\\$]*)`$/);
    body = (str ?? tpl)?.[1] ?? null;
  }
  if (body === null) return null;
  const collapsed = body.replace(/\s+/g, " ").trim();
  return collapsed === "" ? null : collapsed;
}

export interface Finding {
  file: string;
  component: CarrierName;
  prop: string;
  text: string;
}

const SUBTITLE_PROPS: Array<{ component: CarrierName; prop: string }> = [
  { component: "PageHead", prop: "sub" },
  { component: "PageHeader", prop: "subtitle" },
  { component: "SettingsGroup", prop: "description" },
  { component: "Section", prop: "sub" },
];

/** Rule 1 + 2: a literal subtitle, section description or section sub. */
export function findLiteralSubtitles(file: string, text: string): Finding[] {
  const out: Finding[] = [];
  for (const tag of carrierTags(text)) {
    for (const { component, prop } of SUBTITLE_PROPS) {
      if (tag.component !== component) continue;
      const literal = literalText(tag.attrs.get(prop));
      if (literal !== null) out.push({ file, component, prop, text: literal });
    }
  }
  return out;
}

const HELP_COMPONENTS: CarrierName[] = ["FormField", "ToggleField", "WeekdayPicker"];

/** Rule 3: a literal `help` of a field carrier. */
export function findLiteralHelps(file: string, text: string): Finding[] {
  const out: Finding[] = [];
  for (const tag of carrierTags(text)) {
    if (!HELP_COMPONENTS.includes(tag.component)) continue;
    const literal = literalText(tag.attrs.get("help"));
    if (literal !== null) out.push({ file, component: tag.component, prop: "help", text: literal });
  }
  return out;
}

/** How many carriers of `components` pass a `hint` (any value). */
export function countHints(files: SourceFile[], components: CarrierName[]): number {
  let n = 0;
  for (const f of files) {
    for (const tag of carrierTags(f.text)) {
      if (components.includes(tag.component) && tag.attrs.has("hint")) n++;
    }
  }
  return n;
}

export function helpKey(f: Finding): string {
  return `${f.file}::${f.component}::${f.text.slice(0, 40)}`;
}

// ── the register of field helps that stay visible (D-01) ────────────────────

/** The reason of every entry starts with one of these categories (the D-01 list). */
export const VISIBLE_CATEGORIES = [
  "Frist",
  "Sperre",
  "Warnung",
  "Fehler",
  "Rechtsfolge",
  "Folge",
  "Handlung",
  "Zustand",
] as const;

export interface VisibleHelp {
  file: string;
  component: CarrierName;
  /** First 40 characters of the literal help text (whitespace collapsed). */
  prefix: string;
  reason: string;
}

export const VISIBLE_HELP: VisibleHelp[] = [
  {
    file: "lib/components/admin/salons/SalonMasterDataForm.svelte",
    component: "FormField",
    prefix: "Das Bundesland lässt sich später nur ändern",
    reason:
      "Sperre: the Bundesland of a salon cannot change once time entries or assignments reference it.",
  },
  {
    file: "lib/components/admin/protokoll/RetentionSection.svelte",
    component: "FormField",
    prefix: "Nach Ablauf werden Daten automatisch ano",
    reason: "Rechtsfolge: the retention period ends in anonymisation of the data.",
  },
  {
    file: "lib/components/team/aufgaben/RetroReviewBody.svelte",
    component: "FormField",
    prefix: "Pflicht beim Ablehnen",
    reason: "Handlung: the reason is mandatory when rejecting, the person must act on it.",
  },
  {
    file: "lib/components/leave/LeaveReviewDialog.svelte",
    component: "FormField",
    prefix: "Pflicht beim Ablehnen",
    reason: "Handlung: the reason is mandatory when rejecting, the person must act on it.",
  },
  {
    file: "lib/components/employees/CreatePersonDialog.svelte",
    component: "WeekdayPicker",
    prefix: "Pflicht bei Schichtbetrieb: mindestens s",
    reason: "Handlung: shift-based contracts require the usual weekdays before the form saves.",
  },
  {
    file: "lib/components/employees/detail/VertragTab.svelte",
    component: "WeekdayPicker",
    prefix: "Pflicht bei Schichtbetrieb: mindestens s",
    reason: "Handlung: shift-based contracts require the usual weekdays before the form saves.",
  },
  {
    file: "lib/components/employees/detail/VertragTab.svelte",
    component: "ToggleField",
    prefix: "Gesperrt: Überstunden können nur als Fre",
    reason: "Sperre: the overtime mode is locked while the contract has no monthly hours.",
  },
  {
    file: "lib/components/employees/detail/VertragOverrides.svelte",
    component: "FormField",
    prefix: "ArbZG-Minimum: 30 Min",
    reason: "Rechtsfolge: the statutory minimum break (§ 4 ArbZG) bounds the value.",
  },
  {
    file: "lib/components/employees/detail/VertragOverrides.svelte",
    component: "FormField",
    prefix: "ArbZG-Minimum: 45 Min",
    reason: "Rechtsfolge: the statutory minimum break (§ 4 ArbZG) bounds the value.",
  },
  {
    file: "lib/components/admin/integrationen/SmtpSection.svelte",
    component: "FormField",
    prefix: "Der Test nutzt die gespeicherten Einstel",
    reason:
      "Handlung: unsaved changes must be saved first, otherwise the connection test runs against the old settings.",
  },
  {
    file: "lib/components/employees/detail/ZugangTab.svelte",
    component: "ToggleField",
    prefix: "Diese Aktion steht danach im Protokoll.",
    reason:
      "Folge: the irreversible hard delete is written to the audit log (shown as the Protokoll).",
  },
  {
    file: "routes/(app)/inbox/+page.svelte",
    component: "FormField",
    prefix: "Verwaltungsvermerk zur Nachvollziehbarkeit",
    reason: "Rechtsfolge: the note is part of the audit trail, so it must not hold a diagnosis.",
  },
];

// ── the walk ────────────────────────────────────────────────────────────────

/** Named exclusion: operator console, outside the inventory (P-06). */
const EXCLUDED = ["lib/components/operator/"];

function scan(): SourceFile[] {
  const routes = walkFiles(join(SRC_ROOT, "routes/(app)"), [".svelte"], {
    includeTests: false,
  }).map((f) => ({ ...f, rel: `routes/(app)/${f.rel}` }));
  const components = walkFiles(join(SRC_ROOT, "lib/components"), [".svelte"], {
    includeTests: false,
  }).map((f) => ({ ...f, rel: `lib/components/${f.rel}` }));
  return [...routes, ...components].filter((f) => !EXCLUDED.some((x) => f.rel.startsWith(x)));
}

const FILES = scan();

// ── controls: every matcher can fail ────────────────────────────────────────

describe("info-hint-rule-1058 - the matchers can fail (positive and negative controls)", () => {
  const sub = (src: string) => findLiteralSubtitles("x.svelte", src).map((f) => f.text);

  it("flags a literal page subtitle in every literal spelling", () => {
    expect(sub('<PageHead title="x" sub="Erklärt etwas." />')).toEqual(["Erklärt etwas."]);
    expect(sub('<PageHeader title="x" subtitle="Erklärt etwas." />')).toEqual(["Erklärt etwas."]);
    expect(sub('<PageHead title="x" sub={"Erklärt"} />')).toEqual(["Erklärt"]);
    expect(sub("<PageHead title=\"x\" sub={'Erklärt'} />")).toEqual(["Erklärt"]);
    expect(sub('<PageHead title="x" sub={`Erklärt`} />')).toEqual(["Erklärt"]);
    expect(sub('<PageHead\n  title="x"\n  sub="Erklärt\n    zweizeilig."\n/>')).toEqual([
      "Erklärt zweizeilig.",
    ]);
  });

  it("flags a literal SettingsGroup description and a literal Section sub", () => {
    expect(sub('<SettingsGroup title="t" description="Erklärt etwas." />')).toEqual([
      "Erklärt etwas.",
    ]);
    expect(sub('<Section title="t" sub="Erklärt etwas." />')).toEqual(["Erklärt etwas."]);
  });

  it("does not flag computed texts, hints or the wrong prop", () => {
    expect(sub('<PageHead title="x" sub={headSentence} />')).toEqual([]);
    expect(sub('<PageHead title="x" sub={`${n} Personen`} />')).toEqual([]);
    expect(sub('<PageHead title="x" sub={ok ? "A" : "B"} />')).toEqual([]);
    expect(sub('<PageHead title="x" sub="Hallo {name}" />')).toEqual([]);
    expect(sub('<PageHead title="x" hint="Erklärt etwas." />')).toEqual([]);
    expect(sub('<SettingsGroup title="t" hint="Erklärt etwas." />')).toEqual([]);
    expect(sub('<PageHead title="x" sub="" />')).toEqual([]);
    // `sub` on a component that is not a carrier of it
    expect(sub('<Other sub="Erklärt etwas." />')).toEqual([]);
    expect(sub('<PageHeader title="x" sub="Erklärt etwas." />')).toEqual([]);
  });

  it("does not read a literal inside an HTML comment, a script or a style", () => {
    expect(sub('<!-- <PageHead sub="Erklärt etwas." /> -->')).toEqual([]);
    expect(sub("<script>const s = '<PageHead sub=\"Erklärt etwas.\" />';</script>")).toEqual([]);
    expect(sub('<style>/* <PageHead sub="Erklärt etwas." /> */</style>')).toEqual([]);
  });

  it("reads the start tag brace- and quote-aware", () => {
    // `=>` and `>` inside braces or quotes do not end the tag
    expect(
      sub('<PageHead title="x" onclick={() => go()} cond={a > b} sub="Erklärt etwas." />'),
    ).toEqual(["Erklärt etwas."]);
    expect(sub('<PageHead title="a > b" sub="Erklärt etwas." />')).toEqual(["Erklärt etwas."]);
    expect(sub('<PageHead {...rest} sub="Erklärt etwas." />')).toEqual(["Erklärt etwas."]);
    // a tag that closes before the prop does not leak a later sibling's prop into it
    expect(sub('<PageHead title="x" />\n<Other sub="Erklärt etwas." />')).toEqual([]);
  });

  it("reports a literal field help with file, component and text prefix", () => {
    const found = findLiteralHelps(
      "lib/a.svelte",
      '<FormField label="a" help="Pflicht beim Ablehnen" />\n<ToggleField label="b" help="Zweiter Text" />\n<WeekdayPicker legend="c" help={"Dritter Text"} />',
    );
    expect(found.map(helpKey)).toEqual([
      "lib/a.svelte::FormField::Pflicht beim Ablehnen",
      "lib/a.svelte::ToggleField::Zweiter Text",
      "lib/a.svelte::WeekdayPicker::Dritter Text",
    ]);
    // computed helps and `hint` are not literal helps
    expect(
      findLiteralHelps(
        "x",
        '<FormField label="a" help={state ? "A" : "B"} />\n<FormField label="a" hint="Erklärt" />',
      ),
    ).toEqual([]);
  });

  it("counts the hint carriers", () => {
    const files = [
      {
        rel: "a",
        abs: "a",
        text: '<PageHead title="x" hint="a" />\n<PageHeader title="y" hint="b" />',
      },
      { rel: "b", abs: "b", text: '<PageHead title="x" sub="a" />' },
    ];
    expect(countHints(files, ["PageHead", "PageHeader"])).toBe(2);
    expect(countHints(files, ["FormField"])).toBe(0);
  });
});

// ── the rule on the tree ────────────────────────────────────────────────────

describe("info-hint-rule-1058 - the scan is not vacuous (floors)", () => {
  it("walks the web app sources", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(200);
    expect(FILES.some((f) => f.rel.startsWith("routes/(app)/"))).toBe(true);
    expect(FILES.some((f) => f.rel.startsWith("lib/components/"))).toBe(true);
    // the named exclusion is real and applied
    expect(FILES.some((f) => f.rel.startsWith("lib/components/operator/"))).toBe(false);
  });

  it("finds the migrated carriers (a renamed prop or a moved directory turns this red)", () => {
    expect(countHints(FILES, ["PageHead", "PageHeader"])).toBeGreaterThanOrEqual(30);
    expect(countHints(FILES, ["SettingsGroup"])).toBeGreaterThanOrEqual(38);
    expect(countHints(FILES, ["FormField"])).toBeGreaterThanOrEqual(50);
  });
});

describe("info-hint-rule-1058 - D-02: no literal page subtitle", () => {
  it("no PageHead or PageHeader passes a literal subtitle (use `hint`; data subtitles are computed)", () => {
    const hits = FILES.flatMap((f) => findLiteralSubtitles(f.rel, f.text)).filter(
      (h) => h.component === "PageHead" || h.component === "PageHeader",
    );
    expect(hits.map((h) => `${h.file} ${h.component}.${h.prop}: ${h.text.slice(0, 50)}`)).toEqual(
      [],
    );
  });
});

describe("info-hint-rule-1058 - D-01: no literal section text", () => {
  it("no SettingsGroup passes a literal `description` and no Section a literal `sub`", () => {
    const hits = FILES.flatMap((f) => findLiteralSubtitles(f.rel, f.text)).filter(
      (h) => h.component === "SettingsGroup" || h.component === "Section",
    );
    expect(hits.map((h) => `${h.file} ${h.component}.${h.prop}: ${h.text.slice(0, 50)}`)).toEqual(
      [],
    );
  });
});

describe("info-hint-rule-1058 - D-01: a visible field help is argued for", () => {
  const found = FILES.flatMap((f) => findLiteralHelps(f.rel, f.text));
  const foundKeys = new Set(found.map(helpKey));
  const registerKeys = new Set(
    VISIBLE_HELP.map((e) => `${e.file}::${e.component}::${e.prefix.slice(0, 40)}`),
  );

  it("the register is not empty and every file in it exists", () => {
    expect(VISIBLE_HELP.length).toBeGreaterThan(0);
    for (const entry of VISIBLE_HELP) {
      expect(existsSync(join(SRC_ROOT, entry.file)), entry.file).toBe(true);
    }
  });

  it("every register reason starts with a D-01 category", () => {
    const pattern = new RegExp(`^(${VISIBLE_CATEGORIES.join("|")}): \\S`);
    for (const entry of VISIBLE_HELP) {
      expect(entry.reason, `${entry.file} ${entry.prefix}`).toMatch(pattern);
    }
  });

  it("the literal helps found equal the register, in both directions", () => {
    const unregistered = [...foundKeys].filter((k) => !registerKeys.has(k));
    const stale = [...registerKeys].filter((k) => !foundKeys.has(k));
    expect({ unregistered, stale }).toEqual({ unregistered: [], stale: [] });
  });
});
