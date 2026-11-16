import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Issue #1013 (owner 16.11.2026): until Aufgaben can decide a month correction request, Ich › Zeiten
// offers no new request on a closed day. When #1013 ships, flip the switch and this test with it.
// The module imports the API client (localStorage at load), so its source is read instead.
const MODULE = readFileSync(resolve(__dirname, "../month-corrections.ts"), "utf8");
const PAGE = readFileSync(
  resolve(__dirname, "../../../routes/(app)/time-entries/+page.svelte"),
  "utf8",
);

describe("#1013 — no month correction request without a place to decide it", () => {
  it("the switch is off for v2.0.0", () => {
    expect(MODULE).toMatch(/export const MONTH_CORRECTION_REQUESTS_OPEN = false;/);
  });

  it("the closed-day primary action honours the switch", () => {
    const start = PAGE.indexOf("const sheetPrimary = $derived.by(");
    const body = PAGE.slice(start, PAGE.indexOf("});", start));
    expect(body).toContain("!MONTH_CORRECTION_REQUESTS_OPEN ||");
    expect(body.indexOf("!MONTH_CORRECTION_REQUESTS_OPEN")).toBeLessThan(
      body.indexOf('"Korrektur anfragen"'),
    );
  });

  it("the closed-month note sends the person to the Salonleitung instead", () => {
    expect(PAGE).toContain("sprich deine");
    expect(PAGE).toContain("Salonleitung an.");
  });
});
