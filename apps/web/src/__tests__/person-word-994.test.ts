// Issue #994 (N-04, D-994-09) — the glossary row "Person where the role does not matter", made checkable for the
// masculine standalone word: no shown text in src/routes or src/lib says "Mitarbeiter" / "Mitarbeitern" /
// "Mitarbeiters". It reads exactly what `lint:ui-terms` reads (the extractors of that script), so a comment, a
// test file or an import never counts. The staff as a group stays "Mitarbeitende", the feminine form and
// compounds ("Mitarbeiterin", "Mitarbeiterprofil") are other words, and the one stored role name is data.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { listScannedFiles, svelteTexts, tsLiterals } from "../../scripts/lint-ui-terms.mjs";

type Push = (line: number, text: string) => void;

const WORD = /\bMitarbeiter(?:n|s)?\b/;

/** The one named exception: the stored name of the system role (data, not a label), matched by file AND text. */
const ROLE_NAME_EXCEPTION = {
  file: "src/lib/roles/assignment-label.ts",
  text: "Mitarbeiter",
};

interface Finding {
  file: string;
  line: number;
  text: string;
}

function findings(file: string, source: string): Finding[] {
  const out: Finding[] = [];
  const push: Push = (line, text) => {
    if (!WORD.test(text)) return;
    const clean = text.replace(/\s+/g, " ").trim();
    if (file === ROLE_NAME_EXCEPTION.file && clean === ROLE_NAME_EXCEPTION.text) return;
    out.push({ file, line, text: clean });
  };
  if (file.endsWith(".svelte")) svelteTexts(source, push);
  else tsLiterals(source, 1, push);
  return out;
}

const WEB_ROOT = resolve(__dirname, "../..");

describe("shown text says Person, never the masculine Mitarbeiter (Issue #994, N-04)", () => {
  it("walks the whole scanned tree (non-vacuity)", () => {
    const files = listScannedFiles();
    expect(files.length).toBeGreaterThanOrEqual(300);
    expect(files.some((f) => f.endsWith("routes/(app)/admin/month-close/+page.svelte"))).toBe(true);
    expect(files.some((f) => f.endsWith("lib/roles/assignment-label.ts"))).toBe(true);
  });

  it("finds no shown standalone Mitarbeiter in src/routes and src/lib", () => {
    const all: Finding[] = [];
    for (const full of listScannedFiles()) {
      const file = relative(WEB_ROOT, full).split("\\").join("/");
      all.push(...findings(file, readFileSync(full, "utf8")));
    }
    expect(all.map((f) => `${f.file}:${f.line} ${f.text}`)).toEqual([]);
  });

  it("keeps the stored role name as its one exception, which the guard still sees", () => {
    const source = readFileSync(resolve(WEB_ROOT, ROLE_NAME_EXCEPTION.file), "utf8");
    expect(source).toContain(`"${ROLE_NAME_EXCEPTION.text}"`);
    // Without the exception the same file would be reported: the exemption is real, not a blind spot.
    const raw: string[] = [];
    tsLiterals(source, 1, (_l, t) => raw.push(t));
    expect(raw.some((t) => WORD.test(t))).toBe(true);
    // A second shown "Mitarbeiter" in that file is NOT covered by the exception.
    expect(findings(ROLE_NAME_EXCEPTION.file, `export const X = "Kein Mitarbeiter";`)).toHaveLength(
      1,
    );
    // The same literal in another file is not covered either.
    expect(findings("src/lib/other.ts", `export const Y = "Mitarbeiter";`)).toHaveLength(1);
  });

  describe("controls", () => {
    it("positive: a shown Mitarbeiter in markup is one finding", () => {
      expect(findings("src/lib/Example.svelte", `<p>Kein Mitarbeiter gefunden</p>`)).toHaveLength(
        1,
      );
    });

    it("positive: the inflected forms and a script literal are found", () => {
      expect(
        findings(
          "src/lib/Example.svelte",
          `<script lang="ts">const a = "Alle Mitarbeitern";</script><p>Des Mitarbeiters</p>`,
        ),
      ).toHaveLength(2);
    });

    it("negative: other words and a comment are no finding", () => {
      expect(findings("src/lib/Example.svelte", `<p>Alle Mitarbeitende</p>`)).toEqual([]);
      expect(findings("src/lib/Example.svelte", `<p>Eine Mitarbeiterin</p>`)).toEqual([]);
      expect(findings("src/lib/Example.svelte", `<p>Das Mitarbeiterprofil</p>`)).toEqual([]);
      expect(findings("src/lib/example.ts", `// Mitarbeiter\nexport const Z = 1;`)).toEqual([]);
    });
  });
});
