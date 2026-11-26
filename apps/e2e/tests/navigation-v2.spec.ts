/**
 * Issue #844 — Navigation v2: the start page per role (Z-02), old URLs redirect to their new place
 * (in the app and as a 308 for e-mail / push deep links), and the rail shows every entry of a role
 * without scrolling at 1440×900. Since the owner's spacing decision of 13.11.2026 (34 px rows, 40 px
 * mark) the rail may scroll at 1024×768; there every entry must still be reachable in the rail.
 *
 * Every test runs in its own throwaway tenant (tenant fixture). Persons are created through the API
 * and get their system role template assigned (ids copied from SYSTEM_ROLE_IDS in
 * apps/api/src/contexts/platform/system-roles.ts — this package cannot import apps/api).
 */
import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { test, expect, type TestTenant } from "../fixtures";
import { login, loginAsTenantAdmin } from "./helpers";

const API_BASE = process.env.E2E_API_BASE ?? "http://localhost:4001";
const PASSWORD = `Nav-${randomUUID()}!`;

const TEMPLATE = {
  OWNER: "00000000-0000-4000-8000-00000000a004",
  SALON_MANAGER: "00000000-0000-4000-8000-00000000a005",
  HR: "00000000-0000-4000-8000-00000000a006",
} as const;

function adminHeaders(tenant: TestTenant) {
  return { authorization: `Bearer ${tenant.adminToken}`, "content-type": "application/json" };
}

function firstOfPreviousMonth(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString();
}

async function firstSalonId(request: APIRequestContext, tenant: TestTenant): Promise<string> {
  const res = await request.get(`${API_BASE}/api/v1/salons`, { headers: adminHeaders(tenant) });
  expect(res.ok(), `GET /salons (${res.status()})`).toBe(true);
  const body = (await res.json()) as { id: string }[] | { salons: { id: string }[] };
  const rows = Array.isArray(body) ? body : body.salons;
  expect(rows.length).toBeGreaterThan(0);
  return rows[0].id;
}

/** A person with a password and the Mitarbeiter role; optionally a further system role template. */
async function createPerson(
  request: APIRequestContext,
  tenant: TestTenant,
  key: string,
  template?: { id: string; scope: Record<string, unknown> },
): Promise<string> {
  const email = `${key}.${tenant.tenantId.toLowerCase()}@example.invalid`;
  const res = await request.post(`${API_BASE}/api/v1/employees`, {
    headers: adminHeaders(tenant),
    data: {
      email,
      firstName: "Nav",
      lastName: key,
      employeeNumber: `E844-${key}-${tenant.tenantId.slice(-4)}`,
      hireDate: firstOfPreviousMonth(),
      scheduleType: "FIXED_SCHEDULE",
      weeklyHours: 40,
      password: PASSWORD,
    },
  });
  expect(res.status(), `create ${key} (${await res.text()})`).toBe(201);
  const { userId } = (await res.json()) as { userId: string };
  if (template) {
    const assign = await request.post(`${API_BASE}/api/v1/role-assignments`, {
      headers: adminHeaders(tenant),
      data: { userId, accessRoleId: template.id, scope: template.scope },
    });
    expect(assign.status(), `assign ${key} (${await assign.text()})`).toBe(201);
  }
  return email;
}

test.describe("Navigation v2 — start page per role (Z-02)", () => {
  test("Mitarbeiterin → Ich › Mein Tag", async ({ page, request, tenant }) => {
    const email = await createPerson(request, tenant, "mia");
    await login(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/ich\/tag$/);
    // Since #845 the H1 of Ich › Mein Tag is the greeting (prototype); the page name stays the
    // document title.
    await expect(page).toHaveTitle("Mein Tag – Clokr");
    await expect(
      page.getByRole("heading", { level: 1, name: /^Guten (Morgen|Tag|Abend), \S/ }),
    ).toBeVisible();
    // one role, one area (Z-01)
    const rail = page.getByRole("complementary", { name: "Hauptnavigation", exact: true });
    await expect(rail.getByRole("navigation")).toHaveCount(1);
    await expect(rail.getByRole("navigation", { name: "Ich", exact: true })).toBeVisible();
  });

  test("Salonmanager → Team › Heute im Salon", async ({ page, request, tenant }) => {
    const salonId = await firstSalonId(request, tenant);
    const email = await createPerson(request, tenant, "salon", {
      id: TEMPLATE.SALON_MANAGER,
      scope: { type: "SALONS", salonIds: [salonId] },
    });
    await login(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/team\/heute$/);
    await expect(page.getByRole("heading", { level: 1, name: /Heute im Salon/ })).toBeVisible();
  });

  // #992 N-15: the page serves her the tabs Heute and Verläufe (team-overview:read), so the Team rail lists it.
  test("Salonmanager sees Berichte in the Team rail", async ({ page, request, tenant }) => {
    const salonId = await firstSalonId(request, tenant);
    const email = await createPerson(request, tenant, "salonberichte", {
      id: TEMPLATE.SALON_MANAGER,
      scope: { type: "SALONS", salonIds: [salonId] },
    });
    await login(page, email, PASSWORD);
    const rail = page.getByRole("complementary", { name: "Hauptnavigation", exact: true });
    const team = rail.getByRole("navigation", { name: "Team", exact: true });
    await expect(team.getByRole("link", { name: "Berichte", exact: true })).toBeVisible();
  });

  test("Inhaber → Team › Heute im Salon, with all three areas", async ({
    page,
    request,
    tenant,
  }) => {
    const email = await createPerson(request, tenant, "owner", {
      id: TEMPLATE.OWNER,
      scope: { type: "TENANT" },
    });
    await login(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/team\/heute$/);
    const rail = page.getByRole("complementary", { name: "Hauptnavigation", exact: true });
    for (const area of ["Ich", "Team", "Verwalten"]) {
      await expect(rail.getByRole("navigation", { name: area, exact: true })).toBeVisible();
    }
  });

  test("Personalabteilung → Verwalten › Übersicht", async ({ page, request, tenant }) => {
    const email = await createPerson(request, tenant, "hr", {
      id: TEMPLATE.HR,
      scope: { type: "TENANT" },
    });
    await login(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/verwalten$/);
    await expect(page.getByRole("heading", { level: 1, name: /Übersicht/ })).toBeVisible();
  });
});

test.describe("Navigation v2 — old URLs land on the new place", () => {
  test("in the app: every old URL of the acceptance criteria redirects, query kept", async ({
    page,
    tenant,
  }) => {
    await loginAsTenantAdmin(page, tenant);
    const CASES: [string, RegExp][] = [
      ["/inbox?tab=x", /\/team\/aufgaben\?tab=x$/],
      ["/team/leave", /\/team\/abwesenheiten(\?|$)/],
      ["/teamcal", /\/team\/abwesenheiten(\?|$)/],
      ["/admin/vacation", /\/verwalten\/regeln\/abwesenheiten(#.*)?$/],
      ["/verwalten/regeln/urlaub", /\/verwalten\/regeln\/abwesenheiten(#.*)?$/],
      ["/admin/special-leave", /\/verwalten\/regeln\/abwesenheiten#sonderurlaub$/],
      // The company shutdown list is a tab of Abwesenheiten (#854): the old URL and the table URL both land there.
      ["/admin/shutdowns", /\/verwalten\/regeln\/abwesenheiten#betriebsurlaub$/],
      ["/verwalten/regeln/betriebsurlaub", /\/verwalten\/regeln\/abwesenheiten#betriebsurlaub$/],
      ["/admin/system", /\/verwalten\/system\/allgemein(\?|#|$)/],
      ["/dashboard", /\/ich\/tag$/],
      ["/admin", /\/verwalten$/],
    ];
    for (const [from, to] of CASES) {
      await page.goto(from);
      await expect(page, from).toHaveURL(to);
      await expect(page.locator("h1").first(), from).toBeVisible();
    }
  });

  test("a deep link of a notification opens with a 308 on the server and keeps its query", async ({
    request,
    baseURL,
  }) => {
    const res = await request.get(`${baseURL}/leave?tab=antraege&highlight=abc`, {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(308);
    expect(res.headers()["location"]).toBe("/ich/abwesenheiten?tab=antraege&highlight=abc");
  });
});

test.describe("Navigation v2 — the rail fits without scrolling", () => {
  for (const viewport of [{ width: 1440, height: 900 }]) {
    test(`Inhaber at ${viewport.width}×${viewport.height}`, async ({ page, request, tenant }) => {
      const email = await createPerson(request, tenant, "railowner", {
        id: TEMPLATE.OWNER,
        scope: { type: "TENANT" },
      });
      await page.setViewportSize(viewport);
      await login(page, email, PASSWORD);
      const scroll = page.locator(".sidebar-scroll");
      await expect(scroll).toBeVisible();
      const { scrollHeight, clientHeight, items } = await scroll.evaluate((el) => ({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        items: el.querySelectorAll("a.nav-item").length,
      }));
      expect(items, "the Inhaber has entries in all three areas").toBeGreaterThanOrEqual(15);
      expect(scrollHeight, "no rail scrolling").toBeLessThanOrEqual(clientHeight);
    });
  }

  // Owner 13.11.2026: at 1024×768 the rail scrolls inside itself; the page never does, and the last
  // entry of the longest role menu is reachable by scrolling the rail.
  test("Inhaber at 1024×768: the rail scrolls and its last entry is reachable", async ({
    page,
    request,
    tenant,
  }) => {
    const email = await createPerson(request, tenant, "railsmall", {
      id: TEMPLATE.OWNER,
      scope: { type: "TENANT" },
    });
    await page.setViewportSize({ width: 1024, height: 768 });
    await login(page, email, PASSWORD);
    const scroll = page.locator(".sidebar-scroll");
    await expect(scroll).toBeVisible();
    const items = scroll.locator("a.nav-item");
    expect(
      await items.count(),
      "the Inhaber has entries in all three areas",
    ).toBeGreaterThanOrEqual(15);
    const last = items.last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    // Polled, not read once: the entries fade in with a transform, so a box read mid-animation sits
    // a fraction of a pixel lower than the settled one. The bound itself is unchanged.
    await expect
      .poll(
        async () => {
          await last.scrollIntoViewIfNeeded();
          const box = await last.boundingBox();
          const railBox = await scroll.boundingBox();
          if (!box || !railBox) return Number.POSITIVE_INFINITY;
          return box.y + box.height - (railBox.y + railBox.height);
        },
        { message: "the last entry lies inside the rail's scroll area" },
      )
      .toBeLessThanOrEqual(1);
  });
});

// Issue #945 — on a phone the tab bar shows the role's most used pages (derived from its permissions and the
// route table), each under its page name, and the page title in the header is never cut off: the salon
// selection shrinks to its icon.
test.describe("Navigation v2 — phone tab bar per role and an uncut title (#945)", () => {
  async function createSalon(request: APIRequestContext, tenant: TestTenant): Promise<void> {
    const week = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: "09:00", close: "18:00" }));
    const res = await request.post(`${API_BASE}/api/v1/salons`, {
      headers: adminHeaders(tenant),
      data: {
        name: `Süd ${tenant.tenantId.slice(-4)}`,
        federalState: "HESSEN",
        openingHours: week,
      },
    });
    expect(res.status(), `create salon (${await res.text()})`).toBe(201);
  }

  const ROLES = [
    {
      key: "mia945",
      title: "Mitarbeiterin",
      template: undefined,
      tabs: ["Mein Tag", "Zeiten", "Abwesenheiten", "Dienstplan", "Mehr"],
      page: "/ich/abwesenheiten",
      heading: "Abwesenheiten",
    },
    {
      key: "salon945",
      title: "Salonleitung",
      template: "SALON_MANAGER",
      tabs: ["Mein Tag", "Heute im Salon", "Aufgaben", "Zeiten", "Mehr"],
      page: "/team/dienstplan",
      heading: "Dienstplan",
    },
    {
      key: "hr945",
      title: "Personalabteilung",
      template: "HR",
      tabs: ["Mein Tag", "Personen", "Monatsabschluss", "Berichte", "Mehr"],
      page: "/verwalten/monatsabschluss",
      heading: "Monatsabschluss",
    },
  ] as const;

  for (const role of ROLES) {
    test(`${role.title} at 390 and 360 px`, async ({ page, request, tenant }) => {
      const salonId = await firstSalonId(request, tenant);
      const email = await createPerson(
        request,
        tenant,
        role.key,
        role.template === undefined
          ? undefined
          : {
              id: TEMPLATE[role.template],
              scope:
                role.template === "SALON_MANAGER"
                  ? { type: "SALONS", salonIds: [salonId] }
                  : { type: "TENANT" },
            },
      );
      // A second salon (created after the person, who thus needs no Stammsalon) makes the header offer the
      // salon selection to whoever reaches both.
      await createSalon(request, tenant);
      await page.setViewportSize({ width: 390, height: 844 });
      await login(page, email, PASSWORD);

      for (const width of [390, 360]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(role.page);
        const bar = page.getByRole("navigation", { name: "Hauptnavigation (mobil)" });
        await expect(bar).toBeVisible();
        const labels = await bar
          .locator(".tab-label")
          .evaluateAll((els) => els.map((el) => (el.textContent ?? "").replace(/­/g, "")));
        expect(labels, `${role.title} ${width}: tab labels`).toEqual([...role.tabs]);
        // Every label fits its slot: nothing is cut off horizontally.
        const cut = await bar
          .locator(".tab-label")
          .evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).length);
        expect(cut, `${role.title} ${width}: cut tab labels`).toBe(0);

        const crumb = page.getByTestId("topbar-crumb");
        await expect(crumb.locator("b[aria-current='page']")).toHaveText(role.heading);
        const fits = await crumb.evaluate(
          (el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1,
        );
        expect(fits, `${role.title} ${width}: the page title is not cut off`).toBe(true);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${role.title} ${width}: no horizontal page scroll`).toBeLessThanOrEqual(
          0,
        );
      }
    });
  }
});
