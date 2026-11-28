// Issue #1109 (owner decision 28.11.2026) — „Resturlaub“ is ONE number on every own-vacation screen:
// the days still free after the pending requests. Ich › Abwesenheiten, Mein Tag and Ich › Konto read
// the server's `freeDays` (Resturlaub facade, #451) and none of them subtracts anything itself.
//
// Source reads, like `leave-page-vocabulary.test.ts`: no route page is mountable under vitest
// (`apps/web/vitest.config.ts` registers no `$app/*` alias), and the claim is about WHERE each page
// takes its figure from.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const LEAVE = read("src/routes/(app)/leave/+page.svelte");
const KONTO = read("src/routes/(app)/ich/konto/+page.svelte");
const DASHBOARD = read("src/routes/(app)/dashboard/+page.svelte");
const FORM = read("src/lib/components/leave/LeaveRequestForm.svelte");

describe("every own-vacation screen reads the server's free days (Issue #1109)", () => {
  it("[vacuity gate] the sources are loaded", () => {
    for (const src of [LEAVE, KONTO, DASHBOARD, FORM]) expect(src.length).toBeGreaterThan(5000);
  });

  it("Ich › Abwesenheiten: the big figure is `vacSummary.free`", () => {
    expect(LEAVE).toContain("let vacRemaining = $derived(vacSummary.free);");
    expect(LEAVE).toContain('{vacRemaining === null ? "–" : formatDays(vacRemaining)}');
  });

  it("Ich › Konto: the KPI and the ledger total are the same summary figure", () => {
    expect(KONTO).toContain("const vacationRemaining = $derived(vacationSummary.free);");
    expect(KONTO).not.toMatch(/vacation\.total\s*\+\s*vacation\.carryOver\s*-\s*vacation\.used/);
  });

  it("Mein Tag: the cell shows `vacation.free`, never `vacation.remaining`", () => {
    expect(DASHBOARD).toContain("value: stats.vacation.free ?? 0,");
    expect(DASHBOARD).not.toContain("value: stats.vacation.remaining");
  });

  it("no screen subtracts the pending days itself", () => {
    for (const [name, src] of [
      ["leave", LEAVE],
      ["konto", KONTO],
      ["dashboard", DASHBOARD],
    ] as const) {
      expect(src, name).not.toMatch(/remaining\s*-\s*(vac)?[pP]ending/);
      expect(src, name).not.toMatch(/-\s*vacSummaryPlanned/);
    }
    // The leave page no longer sums its own request list into a second pending figure.
    expect(LEAVE).not.toContain("pendingVacDays");
  });

  it("the qualifier `(ohne beantragte)` is gone from every screen", () => {
    for (const src of [LEAVE, KONTO, DASHBOARD, FORM]) expect(src).not.toContain("ohne beantragte");
  });

  it("the bar's free segment names no number that could compete with the big one", () => {
    expect(LEAVE).toContain('<span class="lv-key lv-key--free"></span>frei</li>');
    expect(LEAVE).not.toMatch(/formatDays\(vacBar\.free\)/);
  });
});
