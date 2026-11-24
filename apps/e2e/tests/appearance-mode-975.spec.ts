/**
 * Issue #975 - the colour mode follows the device until a person chooses, with no light flash.
 *
 * The first four cases block every app script (`/_app/*.js`), so only the pre-paint script of
 * app.html and its CSP nonce can have set `data-mode`: a failing nonce or a missing script leaves
 * the attribute empty. The remaining cases sign in by API and prove that an account choice wins over
 * the device and that "Wie Gerät" follows it again.
 *
 * Tenant fixture only, no seed, no date dependency. Run by the e2e-ci project.
 */
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import type { TestTenant } from "../fixtures";

const API_BASE = process.env.E2E_API_BASE ?? "http://localhost:4001";
const PASSWORD = "test1234";

/** Aborts every script of the app bundle, so no store can touch `<html>`. */
async function blockAppScripts(page: Page) {
  await page.route(/\/_app\/.*\.js(\?.*)?$/, (route) => route.abort());
}

async function signIn(page: Page, request: APIRequestContext, tenant: TestTenant) {
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
  // Only seeds the session; the device mode key stays untouched (the person never chose).
  await page.addInitScript(({ accessToken, refreshToken, user }) => {
    try {
      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refreshToken);
      localStorage.setItem("user", JSON.stringify(user));
    } catch {
      /* localStorage may be locked; the case then fails on its mode assertion */
    }
  }, auth);
  return auth.accessToken;
}

async function putMode(request: APIRequestContext, token: string, mode: string) {
  const res = await request.put(`${API_BASE}/api/v1/me/preferences`, {
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    data: { mode },
  });
  expect(res.ok(), `store the ${mode} mode (${res.status()})`).toBe(true);
}

test.describe("Issue #975 - before the app script runs", () => {
  test.describe("dark device", () => {
    test.use({ colorScheme: "dark" });

    test("the login page is dark with every app script blocked", async ({ page }) => {
      await blockAppScripts(page);
      await page.goto("/login");
      await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
    });

    test("a stored light choice wins over the dark device, scripts blocked", async ({ page }) => {
      await blockAppScripts(page);
      await page.addInitScript(() => {
        try {
          localStorage.setItem("mode", "light");
        } catch {
          /* ignore */
        }
      });
      await page.goto("/login");
      await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
    });

    test("with the app running, a device switch to light flips the mode live", async ({ page }) => {
      await page.goto("/login");
      await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
      await page.emulateMedia({ colorScheme: "light" });
      await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
    });
  });

  test.describe("light device", () => {
    test.use({ colorScheme: "light" });

    test("the login page is light with every app script blocked", async ({ page }) => {
      await blockAppScripts(page);
      await page.goto("/login");
      await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
    });
  });
});

test.describe("Issue #975 - the account choice", () => {
  test.use({ colorScheme: "dark" });

  test("no stored choice follows the device; an account choice wins; Wie Gerät follows again", async ({
    page,
    request,
    tenant,
  }) => {
    const token = await signIn(page, request, tenant);

    await page.goto("/dashboard");
    await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");

    await putMode(request, token, "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-mode", "light");

    await putMode(request, token, "system");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  });

  test("the profile shows Wie Gerät checked for a person who never chose", async ({
    page,
    request,
    tenant,
  }) => {
    await signIn(page, request, tenant);
    await page.goto("/ich/profil");
    await expect(page.getByRole("radio", { name: "Wie Gerät" }).first()).toBeChecked();
  });
});
