import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Issue #1017: with the tenant's availability system off, Ich › Dienstplan shows no „Meine
// Verfügbarkeit“ tab (not even before the flag is read) and never asks the API for the own
// availability, so no refusal can surface as an error toast.
const PAGE = readFileSync(resolve(__dirname, "../routes/(app)/availability/+page.svelte"), "utf8");

describe("#1017 — availability off: no tab, no read, no hint", () => {
  it("offers the tab only once the flag is read and on", () => {
    expect(PAGE).toMatch(
      /const availabilityOn = \$derived\(\$tenantFeatures\.loaded && \$tenantFeatures\.availabilityEnabled\)/,
    );
    const tabs = PAGE.slice(PAGE.indexOf("const TABS = $derived("));
    expect(tabs.slice(0, 300)).toContain("availabilityOn ?");
  });

  it("reads the own availability only while the system is on", () => {
    expect(PAGE).not.toMatch(/onMount\(load\)/);
    const at = PAGE.indexOf("if (availabilityOn && !availabilityRequested)");
    expect(at, "the read is gated by the flag").toBeGreaterThan(-1);
    expect(PAGE.slice(at, at + 200)).toContain("load()");
    expect(
      PAGE.match(/(?<!function )\bload\(\)/g)?.length,
      "load() is called in one place only",
    ).toBe(1);
  });

  it("falls back to the plan tab when the system is off", () => {
    expect(PAGE).toContain('!availabilityOn && view === "verfuegbarkeit") view = "plan"');
  });
});
