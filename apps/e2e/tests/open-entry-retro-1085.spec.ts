/**
 * Issue #1085 — a day with an OPEN entry (started, never ended), on a phone.
 *
 * The prod report: a day outside the 10-day window had an entry started at 08:30 and never ended.
 * The person tapped „Zeit nachtragen“, the dialog read „Neuer Eintrag“, 08:30-12:30 plus a reason
 * and „Antrag stellen“ answered 409 „Überschneidung mit bestehendem Eintrag … (08:30 – läuft)“: the
 * form filed a NEW entry-first Zeitnachtrag, which the server refuses against the open entry, and
 * the correction request that ends the open entry was never chosen.
 *
 * What the browser proves here, on the real test stack (a tenant with TWO active salons, because the
 * salon choice is what made „Zeit nachtragen“ open a new form on a day that already had an entry;
 * the person holds the admin role so the #64 rule shows them both salons):
 *   a. outside the window: „Zeit nachtragen“ on that day opens the OPEN entry, titled „Ausstempeln
 *      nachtragen“; ending it is refused with the window 403, the form then files a CORRECTION
 *      request (POST /retro-entry-requests, 201) and says that the entry is ended - never a second
 *      entry; a second person approves, and the same entry is closed with the typed times;
 *   b. inside the window: the same button opens the open entry, saving the end closes THAT entry
 *      (PUT 200) and the day still has one entry.
 *
 * Setup goes through the API (the open entries are recorded on behalf by the tenant admin, which the
 * retro window exempts). Dates are computed from the current day in the tenant's zone, which the
 * browser shares. Persons and salons are synthetic. Every wait is on an observable condition.
 */
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import type { TestTenant } from "../fixtures";
import { zonedInstant } from "../helpers/tenant-zone";

const API_BASE = process.env.E2E_API_BASE ?? "http://localhost:4001";
const TENANT_TZ = "Europe/Berlin";
const PERSON_PASSWORD = "OpenEntry!Pw1085";
const SECOND_SALON_NAME = "Zweitsalon Offenheim";

// A phone, in the tenant's zone: the typed "08:30" is the time the server stores and words.
test.use({ timezoneId: TENANT_TZ, viewport: { width: 390, height: 844 } });

interface Person {
  id: string;
  email: string;
}

function authHeaders(tenant: TestTenant) {
  return { "content-type": "application/json", Authorization: `Bearer ${tenant.adminToken}` };
}

/** The calendar day `back` days before today in the tenant's zone, as YYYY-MM-DD. */
function dayBack(back: number): string {
  const [y, m, d] = new Date()
    .toLocaleDateString("sv-SE", { timeZone: TENANT_TZ })
    .split("-")
    .map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  day.setUTCDate(day.getUTCDate() - back);
  return day.toISOString().slice(0, 10);
}

/** The first weekday at or before `dayBack(back)`: the person's contract days are Monday to Friday. */
function weekdayBack(back: number): string {
  for (let n = back; n < back + 7; n += 1) {
    const day = dayBack(n);
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) return day;
  }
  throw new Error("no weekday in seven days");
}

async function createSecondSalon(request: APIRequestContext, tenant: TestTenant) {
  const res = await request.post(`${API_BASE}/api/v1/salons`, {
    headers: authHeaders(tenant),
    data: {
      name: SECOND_SALON_NAME,
      federalState: "HESSEN",
      openingHours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        day,
        open: "09:00",
        close: "18:00",
        ...(day === 6 ? { closed: true } : {}),
      })),
    },
  });
  expect(res.status(), `create the second salon (${await res.text()})`).toBe(201);
}

/** A second administrator with a direct sign-in: the person whose day carries the open entry. */
async function createPerson(request: APIRequestContext, tenant: TestTenant): Promise<Person> {
  // With two active salons the API requires a Stammsalon (400 otherwise); take the first salon.
  const salonsRes = await request.get(`${API_BASE}/api/v1/salons`, {
    headers: authHeaders(tenant),
  });
  expect(salonsRes.ok(), `list the salons (${await salonsRes.text()})`).toBe(true);
  const { salons } = (await salonsRes.json()) as { salons: Array<{ id: string; name: string }> };
  const homeSalon = salons.find((s) => s.name !== SECOND_SALON_NAME) ?? salons[0];
  const stamp = Date.now();
  const email = `offen-${stamp}@${tenant.tenantId}.test`;
  const res = await request.post(`${API_BASE}/api/v1/employees`, {
    headers: authHeaders(tenant),
    data: {
      usualWorkDays: [1, 2, 3, 4, 5],
      email,
      firstName: "Offen",
      lastName: "Eintrag",
      employeeNumber: `OE-${stamp.toString(36).slice(-6)}`,
      hireDate: new Date("2024-01-01T00:00:00.000Z").toISOString(),
      role: "ADMIN",
      password: PERSON_PASSWORD,
      homeSalonId: homeSalon.id,
    },
  });
  expect(res.status(), `create the person (${await res.text()})`).toBeLessThan(300);
  return { id: ((await res.json()) as { id: string }).id, email };
}

/** An entry without an end, recorded on behalf by the tenant admin (exempt from the window). */
async function recordOpenEntry(
  request: APIRequestContext,
  tenant: TestTenant,
  person: Person,
  day: string,
  start: string,
) {
  const res = await request.post(`${API_BASE}/api/v1/time-entries`, {
    headers: authHeaders(tenant),
    data: {
      employeeId: person.id,
      date: day,
      startTime: zonedInstant(day, start, TENANT_TZ).toISOString(),
      breakMinutes: 0,
    },
  });
  expect(res.status(), `record the open entry on ${day} (${await res.text()})`).toBe(201);
}

async function signInAs(page: Page, request: APIRequestContext, person: Person) {
  const res = await request.post(`${API_BASE}/api/v1/auth/login`, {
    headers: { "content-type": "application/json" },
    data: { email: person.email, password: PERSON_PASSWORD },
  });
  expect(res.ok(), `sign in as the person (${res.status()})`).toBe(true);
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

async function entriesOfDay(
  request: APIRequestContext,
  tenant: TestTenant,
  person: Person,
  day: string,
) {
  const res = await request.get(
    `${API_BASE}/api/v1/time-entries?employeeId=${person.id}&from=${day}&to=${day}`,
    { headers: authHeaders(tenant) },
  );
  expect(res.ok(), `read the entries of ${day} (${res.status()})`).toBe(true);
  return (await res.json()) as { id: string; startTime: string; endTime: string | null }[];
}

async function openDay(page: Page, day: string) {
  await page.goto(`/time-entries?date=${day}`);
  await expect(page.getByTestId("time-entries-page")).toBeVisible();
  // The phone shows the chosen day's entries below the month; the open one reads „offen“.
  const panel = page.getByTestId("time-entries-day-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("offen");
}

const eyebrow = (page: Page) => page.locator("[role='dialog'] .modal-eyebrow").first();

test.describe("a day with an open entry (Issue #1085)", () => {
  test("outside the window: „Zeit nachtragen“ opens the open entry, the request ends it, an approval closes it", async ({
    page,
    request,
    tenant,
  }) => {
    await createSecondSalon(request, tenant);
    const person = await createPerson(request, tenant);
    const day = weekdayBack(40);
    await recordOpenEntry(request, tenant, person, day, "08:30");

    await signInAs(page, request, person);
    await openDay(page, day);

    // The add button of the phone opens the OPEN entry, never a new form.
    await page.getByTestId("time-entries-add").click();
    const modal = page.getByTestId("time-entry-modal");
    await expect(modal).toBeVisible();
    await expect(eyebrow(page)).toContainText("Ausstempeln nachtragen");
    await expect(page.getByTestId("time-entry-modal-start")).toHaveValue("08:30");
    await expect(page.getByTestId("time-entry-modal-open-hint")).toBeVisible();

    // Enter the end 12:30; the window refuses the direct change and the request form appears.
    await page.getByTestId("time-entry-modal-end-toggle").check();
    await page.getByTestId("time-entry-modal-end").fill("12:30");
    const refused = page.waitForResponse(
      (res) =>
        /\/api\/v1\/time-entries\/[^/?]+$/.test(res.url()) && res.request().method() === "PUT",
    );
    await page.getByTestId("time-entry-modal-save").click();
    expect((await refused).status()).toBe(403);
    const callout = page.getByTestId("time-entry-retro-callout");
    await expect(callout).toBeVisible();
    await expect(callout).toContainText("läuft noch");
    await expect(callout).toContainText("kein zweiter Eintrag");

    // The request is a CORRECTION of that entry, not a new entry.
    await page.getByTestId("time-entry-retro-reason").fill("Ausstempeln vergessen");
    const filed = page.waitForResponse(
      (res) =>
        res.url().includes("/api/v1/retro-entry-requests") && res.request().method() === "POST",
    );
    await page.getByTestId("time-entry-retro-submit").click();
    expect((await filed).status()).toBe(201);
    await expect(modal).toBeHidden();

    // Until the approval the open entry is untouched and there is still exactly one entry.
    const before = await entriesOfDay(request, tenant, person, day);
    expect(before).toHaveLength(1);
    expect(before[0].endTime).toBeNull();

    // Someone else decides (four eyes): the approval ends the SAME entry with the typed times.
    const pending = await request.get(`${API_BASE}/api/v1/retro-entry-requests?status=PENDING`, {
      headers: authHeaders(tenant),
    });
    expect(pending.ok()).toBe(true);
    const mine = ((await pending.json()) as { id: string; employeeId: string }[]).filter(
      (r) => r.employeeId === person.id,
    );
    expect(mine).toHaveLength(1);
    const approved = await request.patch(
      `${API_BASE}/api/v1/retro-entry-requests/${mine[0].id}/review`,
      { headers: authHeaders(tenant), data: { status: "APPROVED" } },
    );
    expect(approved.status(), `approve the request (${await approved.text()})`).toBe(200);

    const after = await entriesOfDay(request, tenant, person, day);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].endTime).not.toBeNull();
    expect(new Date(after[0].endTime!).getTime()).toBe(
      zonedInstant(day, "12:30", TENANT_TZ).getTime(),
    );

    // The page now shows the closed entry: nothing reads „offen“ or „Ausstempeln fehlt“ any more.
    await page.goto(`/time-entries?date=${day}`);
    const panel = page.getByTestId("time-entries-day-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("08:30");
    await expect(panel).toContainText("12:30");
    await expect(panel).not.toContainText("Ausstempeln fehlt");
  });

  test("inside the window: „Zeit nachtragen“ opens the open entry and saving the end closes that entry", async ({
    page,
    request,
    tenant,
  }) => {
    await createSecondSalon(request, tenant);
    const person = await createPerson(request, tenant);
    const day = weekdayBack(3);
    await recordOpenEntry(request, tenant, person, day, "08:30");

    await signInAs(page, request, person);
    await openDay(page, day);

    await page.getByTestId("time-entries-add").click();
    await expect(page.getByTestId("time-entry-modal")).toBeVisible();
    // A day before today: the forgotten clock-out. Not a new entry, whatever the salon choice.
    await expect(eyebrow(page)).toContainText("Ausstempeln nachtragen");
    await expect(page.getByTestId("time-entry-modal-start")).toHaveValue("08:30");

    await page.getByTestId("time-entry-modal-end-toggle").check();
    await page.getByTestId("time-entry-modal-end").fill("12:30");
    const saved = page.waitForResponse(
      (res) =>
        /\/api\/v1\/time-entries\/[^/?]+$/.test(res.url()) && res.request().method() === "PUT",
    );
    await page.getByTestId("time-entry-modal-save").click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByTestId("time-entry-modal")).toBeHidden();

    const rows = await entriesOfDay(request, tenant, person, day);
    expect(rows).toHaveLength(1);
    expect(rows[0].endTime).not.toBeNull();
    expect(new Date(rows[0].endTime!).getTime()).toBe(
      zonedInstant(day, "12:30", TENANT_TZ).getTime(),
    );
  });
});
