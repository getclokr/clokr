/**
 * Issue #1030 - Sichtbarkeits-Durchlauf (#710) for the Salonansicht of Team › Zeiten.
 *
 * The Salonansicht is an hours raster Person x day, with an Aushilfen block, an open list and an
 * exchange card below the KPIs. A mounted test proves the pieces exist; this spec proves what only a
 * browser can: after each step the thing the user is meant to see lies IN THE VIEWPORT, at 1280, 390
 * and 360 px, light and dark.
 *
 *   1. „Aushilfen aus anderen Salons“: the heading is scrolled to and the helper's table (a person of
 *      the second salon who worked here) is in view;
 *   2. zoom „Monat“: the raster of the calendar month replaces the week and is in view;
 *   3. a click on the helper's day cell opens that person's day (the day sheet) in view.
 *
 * Data (all through the API as the throwaway tenant's admin, no database access, every date derived
 * from "now" in the tenant zone, never hard-coded): a second salon; a person homed in it with a
 * closed entry in the first salon on tenant-local yesterday; a person of the first salon with an open
 * entry on the same day. Tenant fixture only. Names are synthetic.
 */
import type { APIRequestContext } from "@playwright/test";
import { expect } from "../fixtures";
import type { TestTenant } from "../fixtures";
import { defineVisibilityWalkthrough } from "../helpers/visibility-walkthrough";
import {
  API_BASE,
  authHeaders,
  createHomedPerson,
  createSalon,
  listSalons,
} from "../helpers/team-seed";

const TENANT_ZONE = "Europe/Berlin";
const HELPER_LAST_NAME = "Aushilfsprobe";

/** Tenant-local yesterday as `YYYY-MM-DD`: the last day the raster counts. */
function yesterdayInTenantZone(now = new Date()): string {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: TENANT_ZONE }).format(now);
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** A WORK entry written on behalf of a person; `endTime` omitted = an open entry (missing clock-out). */
async function writeEntry(
  request: APIRequestContext,
  tenant: TestTenant,
  spec: { employeeId: string; salonId: string; day: string; endHour?: number },
): Promise<void> {
  const res = await request.post(`${API_BASE}/api/v1/time-entries`, {
    headers: authHeaders(tenant),
    data: {
      employeeId: spec.employeeId,
      salonId: spec.salonId,
      date: spec.day,
      startTime: `${spec.day}T07:00:00.000Z`,
      ...(spec.endHour === undefined
        ? {}
        : { endTime: `${spec.day}T${String(spec.endHour).padStart(2, "0")}:00:00.000Z` }),
    },
  });
  expect(res.status(), `write the entry of ${spec.day} (${await res.text()})`).toBeLessThan(300);
}

let firstSalonName = "";

defineVisibilityWalkthrough({
  title: "Salonansicht Stundenraster",
  path: "/team/zeiten?mode=salon",
  seed: async ({ request, tenant }) => {
    const first = (await listSalons(request, tenant))[0];
    const second = await createSalon(request, tenant, "Zweitsalon Raster");
    firstSalonName = first.name;
    const day = yesterdayInTenantZone();
    const helper = await createHomedPerson(request, tenant, {
      key: "aushilfe1030",
      firstName: "Hilde",
      lastName: HELPER_LAST_NAME,
      homeSalonId: second.id,
      password: "Aushilfe-1030-probe!",
    });
    await writeEntry(request, tenant, {
      employeeId: helper.id,
      salonId: first.id,
      day,
      endHour: 11, // 4 h, no break duty
    });
    // With two active salons a new person needs a Stammsalon: the open entry belongs to the first one.
    const own = await createHomedPerson(request, tenant, {
      key: "offen1030",
      firstName: "Olga",
      lastName: "Offenprobe",
      homeSalonId: first.id,
      password: "Offen-1030-probe!",
    });
    await writeEntry(request, tenant, { employeeId: own.id, salonId: first.id, day });
  },
  ready: async (page) => {
    // The header salon decides the view: choose the first salon, then wait for the hours raster.
    await page.getByRole("combobox", { name: "Salon" }).selectOption({ label: firstSalonName });
    await expect(page.getByTestId("salon-hours-raster")).toBeVisible();
  },
  steps: [
    {
      name: "Aushilfen",
      act: async (page) => {
        await page.getByText(/^Aushilfen aus anderen Salons \(\d+\)$/).scrollIntoViewIfNeeded();
      },
      target: (page) => page.getByTestId("salon-hours-raster"),
    },
    {
      name: "Monat",
      act: async (page) => {
        await page.getByRole("radio", { name: "Monat" }).click();
        await expect(page.getByTestId("salon-hours-period-label")).toContainText(/\d{4}/);
      },
      target: (page) => page.getByTestId("salon-hours-raster"),
    },
    {
      name: "Zelle öffnet den Tag",
      act: async (page) => {
        await page
          .getByTestId("salon-hours-raster")
          .getByRole("button", { name: new RegExp(`${HELPER_LAST_NAME}.*4:00 im Salon`) })
          .click();
      },
      target: (page) => page.getByTestId("day-sheet-primary"),
    },
  ],
});
