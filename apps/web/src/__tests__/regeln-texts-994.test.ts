// Issue #994 (N-10, N-14, N-15, N-19; D-994-01, D-994-03, D-994-11) - the Regeln texts are plain words.
//
// Source pins over the five Regeln components: no text calls a draft bill a legal reference value, no
// text names a role (roles are tenant data, every company names them differently - a text says who gets
// or does something by what that person may do), and the audit trail is called „Protokoll“, never
// „Audit-Eintrag“. The Krankmeldung hint ends with its legal basis in one line.
//
// The pins read the shown text only: comments are stripped, so a comment may name the finding id but
// must not quote a removed literal (it would not fail here, but it would be read by the next person as
// a live text). The positive controls prove the matcher sees what it must see.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SRC_ROOT } from "./design-source-files";

const FILES = [
  "lib/components/admin/arbeitszeit/RetroWindowSection.svelte",
  "lib/components/admin/abwesenheiten/UrlaubPanel.svelte",
  "lib/components/admin/arbeitszeit/AppointmentHintsSection.svelte",
  "lib/components/admin/benachrichtigungen/RemindersSection.svelte",
  "lib/components/admin/dienstplan/DienstplanSettingsPanel.svelte",
] as const;

/** The file without HTML comments, block comments and full-line `//` comments. */
function shownSource(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const FORBIDDEN = /Referentenentwurf|Referenzwert|Manager|Vorgesetzte|Salonleitung|Audit-Eintrag/;

describe("Regeln texts name no role, no draft bill and no „Audit-Eintrag“ (#994)", () => {
  it("the matcher sees what it must (positive controls)", () => {
    expect(FORBIDDEN.test('hint="Ein Manager genehmigt."')).toBe(true);
    expect(FORBIDDEN.test("Vorgesetzte können das überschreiben (mit Audit-Eintrag).")).toBe(true);
    expect(FORBIDDEN.test("Gesetzlicher Referenzwert (ArbZG-Referentenentwurf 2023)")).toBe(true);
    expect(FORBIDDEN.test("wer Anträge genehmigen darf")).toBe(false);
    expect(shownSource("<!-- Manager -->\n// Vorgesetzte\nok")).not.toMatch(FORBIDDEN);
  });

  for (const rel of FILES) {
    it(`${rel} shows none of them`, () => {
      const text = readFileSync(join(SRC_ROOT, rel), "utf8");
      expect(text.length).toBeGreaterThan(500);
      expect(shownSource(text)).not.toMatch(FORBIDDEN);
    });
  }

  it("the Krankmeldung hint ends with its legal basis in one line", () => {
    const text = shownSource(readFileSync(join(SRC_ROOT, FILES[1]), "utf8"));
    expect(text).toContain('"Grundlage: § 5 Abs. 1 EFZG, § 9 BUrlG."');
  });

  it("the retro hint carries no paragraph at all (the setting has no statutory value)", () => {
    const text = shownSource(readFileSync(join(SRC_ROOT, FILES[0]), "utf8"));
    expect(text).not.toContain("§");
  });
});
