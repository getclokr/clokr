// Tests for scripts/lint-docs-terms.mjs (Issue #1064): the Handbuch glossary, du-form and menu-path gate.
//
// The unit tests run on inline sources against the real menu tree parsed from
// apps/web/src/lib/nav/routes.ts, the live-tree tests on the real docs/ files. The control cases
// (a text that must NOT be reported) sit next to the cases that must, so the lint cannot pass by
// reporting nothing.
//
// Run via `pnpm test:scripts` at repo root (see vitest.config.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  extractTexts,
  listScannedFiles,
  menuPathProblems,
  parseMenuTree,
  run,
  scan,
  scanSource,
} from "./lint-docs-terms.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routesSource = fs.readFileSync(path.join(repoRoot, "apps/web/src/lib/nav/routes.ts"), "utf8");
const tree = parseMenuTree(routesSource);

const HANDBUCH = "docs/handbuch/ich/x.md";

/** @param {string} file @param {string} source */
const termsOf = (file, source) => scanSource(file, source, tree).map((f) => f.term);

describe("du-form", () => {
  it("reports the Sie-form with its line number", () => {
    const findings = scanSource(HANDBUCH, "# Titel\n\nBitte melden Sie sich an.\n", tree);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ term: "sie-form", line: 3 });
  });

  it("accepts the du-form", () => {
    expect(termsOf(HANDBUCH, "Melde dich an.\n")).toEqual([]);
  });

  it("reports the ihr-form", () => {
    expect(termsOf(HANDBUCH, "Gebt euch Bescheid\n")).toEqual(["ihr-form"]);
  });
});

describe("what counts as text", () => {
  it("reads inline code like text", () => {
    expect(termsOf(HANDBUCH, "Der Wert `SHIFT_BASED` steht dort.\n")).toEqual(["code-value"]);
  });

  it("ignores fenced code, with backticks and with tildes", () => {
    expect(termsOf(HANDBUCH, "```\nBitte melden Sie sich an. SHIFT_BASED\n```\n")).toEqual([]);
    expect(termsOf(HANDBUCH, "~~~text\nBitte melden Sie sich an.\n~~~\n")).toEqual([]);
  });

  it("ignores HTML comments, multi-line and screenshot notes included", () => {
    expect(
      termsOf(HANDBUCH, "<!--\nBitte melden Sie sich an.\nSHIFT_BASED\n-->\nText ohne Befund\n"),
    ).toEqual([]);
    expect(
      termsOf(
        HANDBUCH,
        '<!-- SCREENSHOT file=bilder/x-01.png role=admin url=/admin/system show="Sie sehen die Seite" -->\n',
      ),
    ).toEqual([]);
  });

  it("ignores a link URL but checks link text and image alt text", () => {
    expect(termsOf(HANDBUCH, "[Zeiten](./zeiten.md) und [Rolle](./SHIFT_BASED.md)\n")).toEqual([]);
    expect(termsOf(HANDBUCH, "[Melden Sie sich an](./a.md)\n")).toEqual(["sie-form"]);
    expect(termsOf(HANDBUCH, "![Ihre Ansicht](bilder/x.png)\n")).toEqual(["sie-form"]);
  });

  it("returns line numbers that survive comments, fences and frontmatter", () => {
    const source = "---\ntitle: Test\n---\n<!-- a\nb -->\n```\ncode\n```\nZeile mit Sie\n";
    expect(extractTexts(HANDBUCH, source).find((t) => /Sie/.test(t.text))?.line).toBe(9);
  });
});

describe("scoped terms", () => {
  it("allows Phorest only in verwalten/ and team/dienstplan.md", () => {
    expect(termsOf("docs/handbuch/ich/dienstplan.md", "Phorest liefert die Schichten.\n")).toEqual([
      "phorest",
    ]);
    expect(
      termsOf("docs/handbuch/verwalten/phorest.md", "Phorest liefert die Schichten.\n"),
    ).toEqual([]);
    expect(termsOf("docs/handbuch/team/dienstplan.md", "Phorest liefert die Schichten.\n")).toEqual(
      [],
    );
  });

  it("separates Mandant from DATEV's Mandantennummer", () => {
    expect(termsOf(HANDBUCH, "Die Mandantennummer steht im Vertrag.\n")).toEqual([]);
    expect(termsOf(HANDBUCH, "Der Mandant ist gesperrt.\n")).toEqual(["mandant"]);
  });

  it("forbids Flag, Generator and Audit-Spur in the whole Handbuch", () => {
    expect(termsOf("docs/handbuch/verwalten/x.md", "Ein Flag markiert die Zeile.\n")).toEqual([
      "flag",
    ]);
    expect(termsOf("docs/handbuch/ich/x.md", "Der Generator läuft.\n")).toEqual(["generator"]);
    expect(termsOf("docs/handbuch/team/x.md", "Die Audit-Spur zeigt es.\n")).toEqual([
      "audit-spur",
    ]);
  });
});

describe("menu paths", () => {
  const ok = [
    "Ich › Zeiten",
    "Ich › Profil › Erscheinungsbild",
    "Team › Dienstplan › Bedarf",
    "Team › Dienstplan › Verfügbarkeit",
    "Verwalten › Regeln › Abwesenheiten › Sonderurlaub",
    "**Verwalten › System › Rollen & Rechte**",
    "Öffne Ich › Zeiten und trage ein.",
  ];
  const bad = [
    "Ich › Zeit",
    "Verwalten › Regeln › Urlaub",
    "Verwalten › Bausteine",
    "Team › Dienstplan › Dienstplan",
  ];

  it.each(ok)("accepts %s", (text) => {
    expect(termsOf(HANDBUCH, `${text}\n`)).toEqual([]);
  });

  it.each(bad)("reports %s as menu-path", (text) => {
    expect(termsOf(HANDBUCH, `${text}\n`)).toEqual(["menu-path"]);
  });

  it("reports the old arrow form but not value changes", () => {
    expect(termsOf(HANDBUCH, "Mein Profil → Meine Geräte\n")).toEqual(["old-menu-path"]);
    expect(termsOf(HANDBUCH, "Der Anspruch ändert sich von 30 → 36 Tage.\n")).toEqual([]);
    expect(termsOf(HANDBUCH, "Das Protokoll zeigt („Feld: alt → neu“).\n")).toEqual([]);
  });

  it("reports an app URL path", () => {
    expect(termsOf(HANDBUCH, "Öffne die Seite unter `/admin/system`.\n")).toEqual(["url-path"]);
  });

  it("exposes the problem list for a path", () => {
    expect(menuPathProblems("Ich › Zeit", tree)).toHaveLength(1);
    expect(menuPathProblems("Ich › Zeiten", tree)).toEqual([]);
  });
});

describe("frontmatter", () => {
  it("checks the values of docs/index.md", () => {
    const source =
      "---\nlayout: home\nhero:\n  name: Clokr\n  text: Melden Sie sich an\n  actions:\n    - text: Zum Handbuch\n      link: /handbuch/\n---\n";
    const findings = scanSource("docs/index.md", source, tree);
    expect(findings.map((f) => f.term)).toEqual(["sie-form"]);
    expect(findings[0].line).toBe(5);
  });
});

describe("run()", () => {
  it("fails on an empty file list", () => {
    const result = run([]);
    expect(result.exitCode).toBe(1);
    expect(result.messages.join("\n")).toMatch(/0 file/);
  });

  it("fails when fewer than 30 routes were parsed", () => {
    const tiny = 'export const AREA_LABELS = { ich: "Ich" };\nexport const APP_ROUTES = [];\n';
    const result = run([path.join(repoRoot, "docs/handbuch/index.md")], { routesSource: tiny });
    expect(result.exitCode).toBe(1);
    expect(result.messages.join("\n")).toMatch(/route/);
  });
});

describe("live tree", () => {
  it("walks at least docs/index.md and docs/handbuch/index.md, with zero findings", () => {
    const files = listScannedFiles().map((f) =>
      path.relative(repoRoot, f).split(path.sep).join("/"),
    );
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files).toContain("docs/index.md");
    expect(files).toContain("docs/handbuch/index.md");
    expect(scan(listScannedFiles())).toEqual([]);
    expect(run().exitCode).toBe(0);
  });

  it("parses at least 30 routes and the chains the Handbuch relies on", () => {
    expect(tree.routeCount).toBeGreaterThanOrEqual(30);
    for (const chain of [
      "Ich › Zeiten",
      "Verwalten › System › Rollen & Rechte",
      "Team › Dienstplan › Verfügbarkeit",
    ]) {
      expect(menuPathProblems(chain, tree), chain).toEqual([]);
    }
  });
});
