// Issue #992 (N-13, S-22; D-992-22, D-992-07) — the availability of a person is built like the own one
// (Ich › Dienstplan › Verfügbarkeit): page head with the name, a Note, the two blocks, the save bar,
// the person in the top-bar crumb. Source pins: the page cannot mount without `$app`, so the files are
// read (comments included — a removed literal is never quoted here).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(`src/${rel}`, "utf8");

const DETAIL = read("routes/(app)/admin/availability/[employeeId]/+page.svelte");
const LIST = read("routes/(app)/admin/availability/+page.svelte");

describe("the person's availability uses the new blocks (D-992-22)", () => {
  it("imports no ListDetail and no admin Section", () => {
    expect(DETAIL).not.toContain("ListDetail");
    expect(DETAIL).not.toMatch(/import\s+Section\s+from\s+["'][^"']*components\/admin/);
    expect(DETAIL).not.toContain("<Section");
  });

  it("heads the page with the person's name and the plain-German hint", () => {
    const head = DETAIL.match(/<PageHead[\s\S]*?\/>/);
    expect(head, "a PageHead tag").not.toBeNull();
    expect(head![0]).toContain("employee.firstName");
    expect(head![0]).toContain("employee.lastName");
    expect(head![0]).toContain("Wann kann die Person arbeiten?");
  });

  it("states the absence sentence as a Note, not as an alert box", () => {
    expect(DETAIL).toContain("<Note");
    expect(DETAIL).not.toContain("alert alert-info");
  });

  it("saves through the SaveBar „Verfügbarkeit speichern“", () => {
    expect(DETAIL).toContain("<SaveBar");
    expect(DETAIL).toContain('saveLabel="Verfügbarkeit speichern"');
    expect(DETAIL).not.toMatch(/Speichert…/);
  });

  it("names the person in the top-bar crumb and draws no crumb line of its own", () => {
    expect(DETAIL).toMatch(/\$effect\(\(\)\s*=>[\s\S]{0,120}showDetailCrumb\(/);
    expect(DETAIL).not.toContain("crumbs=");
    expect(DETAIL).not.toContain("<Breadcrumb");
  });

  it("carries no eyebrow, no emoji and no „Zurück“ button in the head", () => {
    expect(DETAIL).not.toContain('eyebrow="Administration"');
    expect(DETAIL).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(DETAIL).not.toMatch(/>\s*Zurück\s*</);
  });

  it("keeps the two blocks under sentence-case headings", () => {
    expect(DETAIL).toContain("<AvailabilityWeekGrid");
    expect(DETAIL).toContain("<AvailabilityOneOffList");
    expect(DETAIL).toMatch(/<h2[^>]*>\s*Wochenraster\s*<\/h2>/);
    expect(DETAIL).toMatch(/<h2[^>]*>\s*Einmaltermine\s*<\/h2>/);
  });

  it("answers a failed load with an ErrorState and the feature switch-off with an EmptyState", () => {
    expect(DETAIL).toContain("<ErrorState");
    expect(DETAIL).toContain("<EmptyState");
    expect(DETAIL).toContain("Die Person konnte nicht geladen werden.");
    expect(DETAIL).not.toContain("Mitarbeiter konnte nicht geladen werden.");
  });
});

describe("the list names the number (D-992-07, S-22)", () => {
  it("renders the number through personNumberLabel, never bare", () => {
    expect(LIST).toContain("personNumberLabel(row.number)");
    expect(LIST).not.toMatch(/\{row\.number\}<\/span>/);
  });

  it("words the load error with the glossary noun", () => {
    expect(LIST).toContain("Die Personen konnten nicht geladen werden.");
    expect(LIST).not.toContain("Mitarbeiter konnten nicht geladen werden.");
  });
});
