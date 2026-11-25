/**
 * Issue #1066 - Mein Tag on a device whose zone shows another calendar day than the tenant.
 *
 * The fixture tenant lives in Europe/Berlin and the server files a clock stamp under that tenant day.
 * Mein Tag used to ask for today's rows by the date of the BROWSER, so on a device on another calendar
 * day the fresh entry was missing, the stage fell back to "Noch nicht eingestempelt" and "Pause" vanished.
 * mein-tag-845.spec.ts pins its browser to the tenant zone (Issue #1065) and so cannot see this; this spec
 * does the opposite: the browser zone is chosen so that its calendar day differs from Berlin's at the time
 * the spec is loaded, and the spec proves that it does before it clocks in.
 *
 * Pacific/Kiritimati (UTC+14, no DST) is a day ahead of Berlin while Berlin is 11:00-24:00 (CET) or
 * 12:00-24:00 (CEST); Pacific/Pago_Pago (UTC-11, no DST) is a day behind while Berlin is 00:00-12:00 (CET)
 * or 00:00-13:00 (CEST). One of the two always differs, and when Pago_Pago is chosen the difference lasts
 * at least one more hour.
 *
 * Auth: API login plus addInitScript (the model of mein-tag-845.spec.ts). Only auto-waiting assertions.
 */
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import type { TestTenant } from "../fixtures";

const API_BASE = process.env.E2E_API_BASE ?? "http://localhost:4001";
const PASSWORD = "test1234";

const TENANT_ZONE = "Europe/Berlin";

/** The calendar day (YYYY-MM-DD) of an instant in a zone. */
function dayIn(zone: string, at: Date): string {
  return at.toLocaleDateString("sv-SE", { timeZone: zone });
}

const LOADED_AT = new Date();
const DEVICE_ZONE =
  dayIn("Pacific/Kiritimati", LOADED_AT) !== dayIn(TENANT_ZONE, LOADED_AT)
    ? "Pacific/Kiritimati"
    : "Pacific/Pago_Pago";

async function signIn(page: Page, request: APIRequestContext, tenant: TestTenant): Promise<void> {
  const res = await request.post(`${API_BASE}/api/v1/auth/login`, {
    headers: { "content-type": "application/json" },
    data: { email: `admin@${tenant.tenantId}.test`, password: PASSWORD },
  });
  expect(res.ok(), `login as the tenant admin (${res.status()})`).toBe(true);
  const auth = (await res.json()) as {
    accessToken: string;
    refreshToken: string;
    user: Record<string, unknown>;
  };
  await page.addInitScript(({ accessToken, refreshToken, user }) => {
    try {
      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refreshToken);
      localStorage.setItem("user", JSON.stringify(user));
    } catch {
      /* localStorage may be locked; the auth store then falls back to the login page */
    }
  }, auth);
}

test.use({ storageState: { cookies: [], origins: [] } });
test.use({ timezoneId: DEVICE_ZONE });

test("a device on another calendar day keeps the tenant day's running entry: Einstempeln, Pause, reload, Weiterarbeiten, Ausstempeln", async ({
  page,
  request,
  tenant,
}) => {
  await signIn(page, request, tenant);
  await page.goto("/ich/tag");

  // Anti-vacuity: the browser really is on another calendar day than the tenant.
  const browserDay = await page.evaluate(() => {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${mm}-${dd}`;
  });
  expect(browserDay, `browser day in ${DEVICE_ZONE}`).not.toBe(dayIn(TENANT_ZONE, new Date()));

  // The page names the tenant's day, not the device's.
  const tenantDayLabel = new Intl.DateTimeFormat("de-DE", {
    timeZone: TENANT_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  await expect(page.getByTestId("dashboard-page").locator(".page-head .sub")).toContainText(
    tenantDayLabel,
  );

  const stage = page.locator(".clock-stage");
  const state = page.getByTestId("clock-state");

  await expect(state).toHaveText("Noch nicht eingestempelt");

  // Einstempeln: the reload after the clock-in must find the entry the server filed under the tenant day.
  await page.getByRole("button", { name: "Einstempeln", exact: true }).click();
  await expect(state).toHaveText("Du arbeitest");
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();

  // Pause, then a full reload: the first load of the page asks for the tenant day too.
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(state).toHaveText("Pause");
  await page.reload();
  await expect(state).toHaveText("Pause");

  await page.getByRole("button", { name: "Weiterarbeiten", exact: true }).click();
  await expect(state).toHaveText("Du arbeitest");

  await page.getByRole("button", { name: "Ausstempeln", exact: true }).click();
  await expect(stage).toHaveAttribute("data-day-state", "finished");
});
