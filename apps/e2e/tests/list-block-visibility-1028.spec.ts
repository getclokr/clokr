/**
 * Issue #1028 - Sichtbarkeits-Durchlauf (Issue #710) for the shared list block: a widget and a table.
 *
 * Paging is an interaction whose result the person must SEE: the pager text and the first row of the
 * next page have to lie in the viewport after the click, at 1280, 390 and 360 px, light and dark.
 *   (a) Team > Heute im Salon > Aufgaben: seven persons with an open vacation request each (a widget
 *       page holds five rows), „Nächste Seite“ shows „6-7 von 7“ and a row of the second page.
 *   (b) Verwalten > Personen: 27 persons plus the tenant admin (a table page holds 25 rows),
 *       „Nächste Seite“ shows the second page under the table.
 * Tenant fixture only: synthetic `.test` addresses and invented names, requests of the second Monday of
 * next month (computed from today, no fixed date), no sleeps.
 */
import { expect } from "../fixtures";
import { defineVisibilityWalkthrough } from "../helpers/visibility-walkthrough";
import { createEmployee, ensureEntitlement, fileVacation } from "../helpers/team-seed";

/** The second Monday of next month as an ISO day, computed from today. */
function secondMondayOfNextMonth(now = new Date()): { iso: string; year: number } {
  const first = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));
  const offset = (8 - first.getUTCDay()) % 7; // days to the first Monday (0 when the 1st is one)
  const second = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1 + offset + 7));
  return { iso: second.toISOString().slice(0, 10), year: second.getUTCFullYear() };
}

defineVisibilityWalkthrough({
  title: "Heute im Salon Aufgaben Seitenwechsel",
  path: "/team/heute",
  seed: async ({ request, tenant }) => {
    const { iso, year } = secondMondayOfNextMonth();
    for (let i = 1; i <= 7; i++) {
      const person = await createEmployee(request, tenant, {
        key: `aufg${i}`,
        firstName: `Anna${i}`,
        lastName: `Muster${i}`,
      });
      await ensureEntitlement(request, tenant, person.id, year);
      await fileVacation(request, tenant, person.id, iso, iso);
    }
  },
  ready: async (page) => {
    await expect(page.getByTestId("team-tasks-pager")).toBeVisible();
  },
  steps: [
    {
      name: "Nächste Seite",
      act: async (page) => {
        await page
          .getByTestId("team-tasks-pager")
          .getByRole("button", { name: "Nächste Seite" })
          .click();
      },
      target: (page) => [
        page.getByTestId("team-tasks-pager").getByTestId("pager-range"),
        page.getByTestId("team-tasks").getByRole("listitem").first(),
      ],
    },
  ],
});

defineVisibilityWalkthrough({
  title: "Personen Seitenwechsel",
  path: "/verwalten/personen",
  seed: async ({ request, tenant }) => {
    for (let i = 1; i <= 27; i++) {
      await createEmployee(request, tenant, {
        key: `pers${i}`,
        firstName: `Berta${i}`,
        lastName: `Beispiel${i}`,
      });
    }
  },
  ready: async (page) => {
    await expect(page.getByRole("navigation", { name: "Seitennavigation" })).toBeVisible();
  },
  steps: [
    {
      name: "Nächste Seite",
      act: async (page) => {
        await page
          .getByRole("navigation", { name: "Seitennavigation" })
          .getByRole("button", { name: "Nächste Seite" })
          .click();
      },
      target: (page) => [
        page.getByRole("navigation", { name: "Seitennavigation" }).getByTestId("pager-range"),
        page.locator("tbody tr").first(),
      ],
    },
  ],
});
