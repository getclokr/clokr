/**
 * Issue #992 (N-12, D-992-20) - the four Dienstplan tabs are ONE page: the heading and the tab row
 * sit at the same height on every tab, so switching the tab does not make the head jump.
 *
 * What only a browser can show: the position of the `h1` and of the tab strip (a `<nav>` named
 * „Dienstplan“ in link mode) on Woche, Bedarf, Hinweise and Verfügbarkeit at 1440 x 900. The
 * assertion is geometric (same `y` of both, within one pixel) and does not look at any text.
 *
 * The availability feature defaults to on for a tenant (`TenantConfig.availabilityEnabled`), so the
 * fourth tab exists without any setup. No data is needed: the head is rendered whatever the plan holds.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { loginAsTenantAdmin } from "./helpers";

const TABS = [
  { name: "Woche", path: "/team/dienstplan" },
  { name: "Bedarf", path: "/team/dienstplan/planung" },
  { name: "Hinweise", path: "/team/dienstplan/konflikte" },
  { name: "Verfügbarkeit", path: "/team/verfuegbarkeit" },
] as const;

/** The top edge of the page heading and of the tab strip, in CSS pixels. */
async function headGeometry(page: Page): Promise<{ h1: number; tabs: number }> {
  const h1 = page.locator("h1");
  const tabs = page.getByRole("navigation", { name: "Dienstplan", exact: true }).first();
  await expect(h1).toHaveCount(1);
  await expect(tabs).toBeVisible();
  // The staggered entrance animation moves blocks by a few pixels while it runs; the head is
  // compared at rest, so wait until every running animation of the page has finished.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => null))),
  );
  const h1Box = await h1.boundingBox();
  const tabsBox = await tabs.boundingBox();
  expect(h1Box, "h1 has a box").not.toBeNull();
  expect(tabsBox, "tab strip has a box").not.toBeNull();
  return { h1: h1Box!.y, tabs: tabsBox!.y };
}

test.describe("Dienstplan: ein Kopf für vier Reiter (#992)", () => {
  test("Überschrift und Reiterzeile stehen auf allen vier Reitern gleich hoch", async ({
    page,
    tenant,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsTenantAdmin(page, tenant);

    const geometry: Record<string, { h1: number; tabs: number }> = {};
    for (const tab of TABS) {
      await page.goto(tab.path);
      geometry[tab.name] = await headGeometry(page);
    }

    const reference = geometry.Woche;
    for (const tab of TABS) {
      const { h1, tabs } = geometry[tab.name];
      expect(Math.abs(h1 - reference.h1), `${tab.name}: Überschrift`).toBeLessThanOrEqual(1);
      expect(Math.abs(tabs - reference.tabs), `${tab.name}: Reiterzeile`).toBeLessThanOrEqual(1);
    }
  });
});
