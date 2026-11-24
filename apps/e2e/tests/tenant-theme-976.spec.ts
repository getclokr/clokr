/**
 * Issue #976 - the tenant default Farbwelt in a real browser.
 *
 * The tenant fixture admin sets the Standard-Farbwelt through the API and signs in: with no own choice the
 * whole app shows it. The profile offers Standard des Unternehmens as the way back; Verwalten › System ›
 * Allgemein changes the default with a toast, and the admin (no own choice) follows at once. The operator
 * console stays Salz and never asks for /me/preferences. After sign-out the sign-in page shows the device's
 * last shown Farbwelt (it knows no tenant).
 *
 * Tenant fixture only, no seed, no date dependency. Run by the e2e-ci project.
 */
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import type { TestTenant } from "../fixtures";

const API_BASE = process.env.E2E_API_BASE ?? "http://localhost:4001";
const PASSWORD = "test1234";

interface Session {
  accessToken: string;
  refreshToken: string;
  user: Record<string, unknown>;
}

async function login(request: APIRequestContext, tenant: TestTenant): Promise<Session> {
  const res = await request.post(`${API_BASE}/api/v1/auth/login`, {
    headers: { "content-type": "application/json" },
    data: { email: `admin@${tenant.tenantId}.test`, password: PASSWORD },
  });
  expect(res.ok(), `login as the tenant admin (${res.status()})`).toBe(true);
  return (await res.json()) as Session;
}

function authHeaders(session: Session) {
  return {
    "content-type": "application/json",
    Authorization: `Bearer ${session.accessToken}`,
  };
}

async function putWork(request: APIRequestContext, session: Session, defaultUiTheme: string) {
  const res = await request.put(`${API_BASE}/api/v1/settings/work`, {
    headers: authHeaders(session),
    data: { defaultUiTheme },
  });
  expect(res.ok(), `set the Standard-Farbwelt ${defaultUiTheme} (${res.status()})`).toBe(true);
}

async function seedSession(page: Page, session: Session) {
  await page.addInitScript(({ accessToken, refreshToken, user }) => {
    try {
      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refreshToken);
      localStorage.setItem("user", JSON.stringify(user));
    } catch {
      /* localStorage may be locked; the case then fails on its theme assertion */
    }
  }, session);
}

const html = (page: Page) => page.locator("html");

test("a person without an own choice sees the tenant default, and Standard des Unternehmens goes back to it", async ({
  page,
  request,
  tenant,
}) => {
  const session = await login(request, tenant);
  await putWork(request, session, "petrol");
  await seedSession(page, session);

  await page.goto("/dashboard");
  await expect(html(page)).toHaveAttribute("data-theme", "petrol");

  await page.goto("/ich/profil");
  await expect(
    page.getByRole("radio", { name: "Standard des Unternehmens" }).first(),
  ).toBeChecked();
  await expect(page.getByTestId("appearance-default-hint")).toHaveText(
    "Der Standard deines Unternehmens ist Petrol.",
  );

  await page.getByRole("radio", { name: "Salz" }).first().click();
  await expect(html(page)).toHaveAttribute("data-theme", "salz");
  await page.reload();
  await expect(html(page)).toHaveAttribute("data-theme", "salz");

  await page.getByRole("radio", { name: "Standard des Unternehmens" }).first().click();
  await expect(html(page)).toHaveAttribute("data-theme", "petrol");
  const prefs = await request.get(`${API_BASE}/api/v1/me/preferences`, {
    headers: authHeaders(session),
  });
  expect(prefs.ok()).toBe(true);
  const body = (await prefs.json()) as { themeChoice: string | null; theme: string };
  expect(body.themeChoice).toBeNull();
  expect(body.theme).toBe("petrol");
});

test("the Standard-Farbwelt is set under Verwalten › System › Allgemein and the admin follows at once", async ({
  page,
  request,
  tenant,
}) => {
  const session = await login(request, tenant);
  await seedSession(page, session);

  await page.goto("/verwalten/system/allgemein");
  const section = page.getByTestId("admin-system-standard-farbwelt");
  await expect(section.getByRole("heading", { name: "Standard-Farbwelt" })).toBeVisible();

  await section.getByRole("radio", { name: "Salz" }).click();
  await expect(page.getByTestId("toast-region-status")).toContainText("Einstellung gespeichert.");
  await expect(html(page)).toHaveAttribute("data-theme", "salz");

  const work = await request.get(`${API_BASE}/api/v1/settings/work`, {
    headers: authHeaders(session),
  });
  expect(work.ok()).toBe(true);
  expect(((await work.json()) as { defaultUiTheme: string }).defaultUiTheme).toBe("salz");
});

test("the operator console stays Salz and never asks for the preferences of a tenant session", async ({
  page,
  request,
  tenant,
}) => {
  const session = await login(request, tenant);
  await putWork(request, session, "petrol");
  await seedSession(page, session);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("theme", "petrol");
    } catch {
      /* ignore */
    }
  });

  const preferenceRequests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/v1/me/preferences")) preferenceRequests.push(req.url());
  });

  await page.goto("/betreiber/anmelden");
  await expect(html(page)).toHaveAttribute("data-theme", "salz");
  await page.waitForLoadState("networkidle");
  expect(preferenceRequests).toEqual([]);
});

test("after sign-out the sign-in page keeps the device's last shown Farbwelt", async ({
  page,
  request,
  tenant,
}) => {
  const session = await login(request, tenant);
  await putWork(request, session, "petrol");

  // The session is written once into the open page (no init script, which would sign the person in
  // again on every later document).
  await page.goto("/login");
  await page.evaluate((s) => {
    localStorage.setItem("accessToken", s.accessToken);
    localStorage.setItem("refreshToken", s.refreshToken);
    localStorage.setItem("user", JSON.stringify(s.user));
  }, session);

  await page.goto("/dashboard");
  await expect(html(page)).toHaveAttribute("data-theme", "petrol");
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("petrol");

  // Sign out the way the app does: the session keys go, the device's last shown Farbwelt stays.
  await page.evaluate(() => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
  });
  await page.goto("/login");
  await expect(html(page)).toHaveAttribute("data-theme", "petrol");
});
