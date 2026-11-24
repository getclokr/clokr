// Issue #1015 - SvelteKit 3 runs beforeNavigate / afterNavigate callbacks for shallow updates
// (`goto(..., { shallow: true })`); kit 2 never did. A shallow update only rewrites the URL (a tab
// hash, a stripped query parameter) and keeps the page and its unsaved form, so:
//   - the (app) layout's unsaved-changes guard must not open its dialog or cancel it,
//   - the layout's salon re-validation has no page change to follow,
//   - the dashboard's reminder arrival counter must not count its own clock-parameter strip.
//
// Source-read, the established pattern for routes (they import the router and cannot be mounted).
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function readSource(relativeFromHere: string, relativeFromCwd: string): string {
  const fromHere = fileURLToPath(new URL(relativeFromHere, import.meta.url));
  const path = existsSync(fromHere) ? fromHere : resolve(process.cwd(), relativeFromCwd);
  expect(existsSync(path), `source missing: ${relativeFromCwd}`).toBe(true);
  return readFileSync(path, "utf8");
}

const LAYOUT = readSource("../routes/(app)/+layout.svelte", "src/routes/(app)/+layout.svelte");
const DASHBOARD = readSource(
  "../routes/(app)/dashboard/+page.svelte",
  "src/routes/(app)/dashboard/+page.svelte",
);

/** The code of the callback passed to `registration` (comments stripped), up to its closing `});`. */
function callbackBody(source: string, registration: string): string {
  const start = source.indexOf(registration);
  expect(start, `${registration} not found`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n  });", start);
  expect(end).toBeGreaterThan(start);
  return source
    .slice(start + registration.length, end)
    .replace(/^\s*\/\/.*$/gm, "")
    .trim();
}

describe("shallow navigations are no page changes (kit 3)", () => {
  it("(app) layout: the unsaved-changes guard returns before it reads the registry", () => {
    const body = callbackBody(LAYOUT, "beforeNavigate((navigation) => {");
    expect(body.startsWith("if (navigation.shallow) return;")).toBe(true);
    // The guard itself is still there, after the early return.
    expect(body).toContain("if (!hasUnsaved()) return;");
    expect(body).toContain("navigation.cancel();");
  });

  it("(app) layout: the salon re-validation skips a shallow update", () => {
    const body = callbackBody(LAYOUT, "afterNavigate((navigation) => {");
    expect(body.startsWith("if (navigation.shallow ||")).toBe(true);
    expect(body).toContain("navigation.from === null");
    expect(body).toContain("salonContext.load(");
  });

  it("dashboard: the reminder arrival counter returns on a shallow update", () => {
    const body = callbackBody(DASHBOARD, "afterNavigate((navigation) => {");
    expect(body.startsWith("if (navigation.shallow) return;")).toBe(true);
    expect(body).toContain("clockArrival += 1;");
  });
});
