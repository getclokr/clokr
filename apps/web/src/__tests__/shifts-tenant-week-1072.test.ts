// Issue #1072 - source pins of the shift planner's week of "today" (/shifts).
//
// Why source-read and not mounted: the page imports `$app/navigation`, drag-and-drop and fires its
// requests on mount (the same wall `shifts-salon-558.test.ts` documents). The mounted twin of this
// rule is the Planungsbedarf page (`shifts/planning/__tests__/page.test.ts`, cold-store case). What
// matters here is the single-request structure of Issue #558 (WR-03): when the tenant zone puts
// "today" in another week than the start-up value, the cursor moves BEFORE the first request is
// built, and the week-navigation effect must not see that move as a navigation.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

function readRouteFile(relativeFromHere: string, relativeFromCwd: string): string {
  try {
    return readFileSync(fileURLToPath(new URL(relativeFromHere, import.meta.url)), "utf8");
  } catch {
    return readFileSync(resolve(process.cwd(), relativeFromCwd), "utf8");
  }
}

const PAGE = readRouteFile(
  "../routes/(app)/shifts/+page.svelte",
  "src/routes/(app)/shifts/+page.svelte",
);

/** The body of `function <name>(` up to its closing brace at the script's two-space indent. */
function functionBody(name: string, prefix = ""): string {
  const start = PAGE.indexOf(`${prefix}function ${name}(`);
  expect(start, `function ${name} not found`).toBeGreaterThan(-1);
  const next = PAGE.slice(start + 1).search(/\n {2}\}\n/);
  expect(next, `end of ${name} not found`).toBeGreaterThan(-1);
  return PAGE.slice(start, start + 1 + next);
}

describe("Issue #1072 - the shift planner's week is the tenant's week", () => {
  it("[vacuity gate] the page source is loaded and still is the shift planner", () => {
    expect(PAGE.length).toBeGreaterThan(60_000);
    expect(PAGE).toContain("Muster auf die Woche anwenden");
  });

  it("[start] the cursor starts from the tenant day of the store's zone, not the device day", () => {
    expect(PAGE).toContain(
      "let cursorMonday = $state(mondayOfWeek(tenantDayAnchor(new Date(), $tenantFeatures.timezone)))",
    );
    expect(PAGE).toContain(
      "cursorMonday = mondayOfWeek(tenantDayAnchor(new Date(), $tenantFeatures.timezone));",
    );
  });

  it("[single request] the first load awaits the zone, re-anchors, and moves the effect's baseline first", () => {
    const anchor = functionBody("anchorOnTenantZone", "async ");
    expect(anchor).toContain("await tenantFeatures.loadTimezone()");
    expect(anchor).toContain("if (cursorTouched) return;");
    // the baseline of the navigation effect moves BEFORE the cursor, so the effect sees no change
    const baseline = anchor.indexOf("prevCursorMondayTime = monday.getTime()");
    const cursor = anchor.indexOf("cursorMonday = monday");
    expect(baseline).toBeGreaterThan(-1);
    expect(cursor).toBeGreaterThan(baseline);
    const load = functionBody("load", "async ");
    expect(load).toContain("await (zoneAnchoring ??= anchorOnTenantZone())");
    // the URL is built after the await
    expect(load.indexOf("zoneAnchoring")).toBeLessThan(load.indexOf("ymd(cursorMonday)"));
  });

  it("[navigation] every move of the cursor by the person stops the re-anchoring", () => {
    for (const name of ["prevWeek", "nextWeek", "goToToday"]) {
      expect(functionBody(name)).toContain("cursorTouched = true;");
    }
  });

  it("[today] a day is 'today' or past by the tenant day, read per call", () => {
    expect(functionBody("isToday")).toContain("tenantDay(new Date(), $tenantFeatures.timezone)");
    expect(functionBody("isPastDay")).toContain("tenantDay(new Date(), $tenantFeatures.timezone)");
  });
});
