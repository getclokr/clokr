// Tests for scripts/screenshot-notes.mjs (Issue #1064): the capture notes of the Handbuch pages.
//
// The unit tests run on inline Markdown, the live-tree test on the real docs/handbuch files. The
// control cases (a note that must NOT be reported) sit next to the cases that must, so the
// validator cannot pass by reporting nothing.
//
// Run via `pnpm test:scripts` at repo root (see vitest.config.mjs).
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { collectHandbuchNotes, parseScreenshotNotes, validateNotes } from "./screenshot-notes.mjs";

const docsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "docs");

const PAGE = "handbuch/ich/x.md";

/** A well-formed note, optionally with attributes replaced. */
const note = (overrides = {}) => {
  const attrs = {
    file: "bilder/x-01.png",
    role: "emp",
    url: "/ich/tag",
    show: "Mein Tag mit der Uhr",
    ...overrides,
  };
  const body = Object.entries(attrs)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => (k === "show" ? `${k}="${v}"` : `${k}=${v}`))
    .join(" ");
  return `<!-- SCREENSHOT ${body} -->`;
};

describe("parseScreenshotNotes", () => {
  it("returns file, role, url, show and the source line of one note", () => {
    const md = `# Titel\n\nText.\n\n${note()}\n\nMehr Text.\n`;
    expect(parseScreenshotNotes(md, PAGE)).toEqual([
      {
        page: PAGE,
        line: 5,
        file: "bilder/x-01.png",
        role: "emp",
        url: "/ich/tag",
        show: "Mein Tag mit der Uhr",
      },
    ]);
  });

  it("parses a note across several lines and counts its first line", () => {
    const md = `a\n<!-- SCREENSHOT\n  file=bilder/x-01.png\n  role=manager\n  url=/team/heute\n  show="Heute im Salon"\n-->\nb\n`;
    const [parsed] = parseScreenshotNotes(md, PAGE);
    expect(parsed).toMatchObject({
      line: 2,
      role: "manager",
      url: "/team/heute",
      show: "Heute im Salon",
    });
  });

  it("keeps a url with a query string", () => {
    const [parsed] = parseScreenshotNotes(note({ url: "/ich/abwesenheiten?tab=antraege" }), PAGE);
    expect(parsed.url).toBe("/ich/abwesenheiten?tab=antraege");
  });

  it("ignores ordinary comments and text outside notes", () => {
    const md = "<!-- planner-discipline-allow: x -->\nSCREENSHOT file=bilder/x.png\n";
    expect(parseScreenshotNotes(md, PAGE)).toEqual([]);
  });

  it("returns every note of a page in order", () => {
    const md = `${note({ file: "bilder/x-01.png" })}\n\n${note({ file: "bilder/x-02.png" })}\n`;
    expect(parseScreenshotNotes(md, PAGE).map((n) => n.file)).toEqual([
      "bilder/x-01.png",
      "bilder/x-02.png",
    ]);
  });
});

describe("validateNotes", () => {
  /** @param {string} md @param {string} [page] */
  const errorsOf = (md, page = PAGE) => validateNotes(parseScreenshotNotes(md, page));

  it("accepts a well-formed note (control)", () => {
    expect(errorsOf(note())).toEqual([]);
  });

  it("reports a note without file, naming page and line", () => {
    const errors = errorsOf(`\n${note({ file: null })}`);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ page: PAGE, line: 2 });
    expect(errors[0].message).toMatch(/file/);
  });

  it("reports a note without url", () => {
    const errors = errorsOf(note({ url: null }));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/url/);
  });

  it("reports a role outside emp, manager and admin", () => {
    expect(errorsOf(note({ role: "boss" }))[0].message).toMatch(/role/);
    expect(errorsOf(note({ role: null }))[0].message).toMatch(/role/);
    for (const role of ["emp", "manager", "admin"]) expect(errorsOf(note({ role }))).toEqual([]);
  });

  it("reports a file outside bilder/, with a path climb, or not ending in .png", () => {
    expect(errorsOf(note({ file: "x-01.png" }))[0].message).toMatch(/file/);
    expect(errorsOf(note({ file: "bilder/../x-01.png" }))[0].message).toMatch(/file/);
    expect(errorsOf(note({ file: "bilder/x-01.jpg" }))[0].message).toMatch(/file/);
    expect(errorsOf(note({ file: "bilder/sub/x-01.png" }))[0].message).toMatch(/file/);
  });

  it("reports a url that is not an app path", () => {
    expect(errorsOf(note({ url: "https://example.com/" }))[0].message).toMatch(/url/);
    expect(errorsOf(note({ url: "ich/tag" }))[0].message).toMatch(/url/);
  });

  it("reports a duplicate file across pages", () => {
    const first = parseScreenshotNotes(note(), "handbuch/ich/a.md");
    const second = parseScreenshotNotes(note(), "handbuch/ich/b.md");
    const errors = validateNotes([...first, ...second]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ page: "handbuch/ich/b.md" });
    expect(errors[0].message).toMatch(/duplicate/i);
  });
});

describe("collectHandbuchNotes (live docs/handbuch tree)", () => {
  const notes = collectHandbuchNotes(docsDir);

  it("returns notes without a single validation error", () => {
    expect(validateNotes(notes)).toEqual([]);
  });

  it("covers every page that had an image in the wiki", () => {
    // The wiki pages that carried images (archive/wiki-2026-10-03) and the Handbuch page each became.
    const pagesWithWikiImages = [
      "handbuch/erste-schritte.md",
      "handbuch/ich/mein-tag-und-zeiten.md",
      "handbuch/ich/abwesenheiten.md",
      "handbuch/ich/dienstplan.md",
      "handbuch/team/aufgaben.md",
      "handbuch/team/zeiten.md",
      "handbuch/team/dienstplan.md",
      "handbuch/team/berichte.md",
      "handbuch/verwalten/personen.md",
      "handbuch/verwalten/arbeitszeitmodelle.md",
      "handbuch/verwalten/abwesenheiten-und-urlaub.md",
      "handbuch/verwalten/rollen-und-rechte.md",
      "handbuch/verwalten/salons-und-feiertage.md",
      "handbuch/verwalten/monatsabschluss.md",
      "handbuch/verwalten/system-und-daten.md",
    ];
    const pages = new Set(notes.map((n) => n.page));
    for (const page of pagesWithWikiImages) expect(pages, page).toContain(page);
  });

  it("names pages relative to docs/ with forward slashes", () => {
    for (const n of notes) expect(n.page).toMatch(/^handbuch\/.+\.md$/);
  });
});
