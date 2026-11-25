// Issue #1072 - Ich › Zeiten decides today, the month and the year in the TENANT zone. The real page
// is mounted; the process zone is switched and Date faked, so the device and the tenant stand on
// different calendar days (New Year in Berlin while the device is still on 31.12. UTC, a New York
// tenant, a device that is a day ahead). The device clock only says WHEN now is.
const apiGet = vi.fn();

vi.mock("$app/state", () => ({
  page: { url: new URL("http://localhost/time-entries"), params: {}, state: {} },
}));

vi.mock("$stores/auth", async () => {
  const { writable } = await import("svelte/store");
  return {
    authStore: writable({
      user: { id: "u1", employeeId: "emp-1", permissions: [] },
    }),
  };
});

vi.mock("$api/client", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
      public data?: unknown,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    api: {
      get: (...args: unknown[]) => apiGet(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock("$lib/utils/logger", () => ({
  clientLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import { ApiError } from "$api/client";
import { tenantFeatures } from "$stores/tenant-features";
import TimeEntriesPage from "../routes/(app)/time-entries/+page.svelte";

let tenantZone = "Europe/Berlin";

function serve() {
  apiGet.mockImplementation((path: string) => {
    if (path.startsWith("/time-entries")) return Promise.resolve([]);
    if (path.startsWith("/day-breaks/checks")) return Promise.resolve({ days: [] });
    if (path.startsWith("/employees/")) {
      return Promise.resolve({ hireDate: "2020-01-01T00:00:00.000Z", isTimeTrackingExempt: false });
    }
    if (path === "/settings/work") {
      return Promise.resolve({ timezone: tenantZone, arbzgEnabled: true });
    }
    if (path.startsWith("/holidays") || path.startsWith("/leave/requests")) {
      return Promise.resolve([]);
    }
    if (path.startsWith("/vocational-school")) return Promise.resolve([]);
    return Promise.reject(new ApiError(404, "not part of this test"));
  });
}

function withProcessZone(zone: string) {
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = zone;
  });
  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });
}

beforeEach(() => {
  apiGet.mockReset();
  try {
    localStorage.clear();
  } catch {
    /* no storage in this environment; the page tolerates it */
  }
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.spyOn(console, "error").mockImplementation(() => {});
  serve();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Plays the (app) layout - one read of the tenant zone - and mounts the page. */
async function mount() {
  await tenantFeatures.fetch();
  renderWithTheme(TimeEntriesPage, {});
  await waitFor(() => expect(screen.getByTestId("calendar-grid")).toBeTruthy());
}

const paths = () => apiGet.mock.calls.map((c) => String(c[0]));
const monthRequests = () => paths().filter((p) => p.startsWith("/time-entries?from="));
const cell = (day: string) => screen.findByTestId(`calendar-cell-${day}`);

describe("Ich › Zeiten reads the tenant day (#1072)", () => {
  describe("New Year in Berlin, device on UTC", () => {
    withProcessZone("UTC");

    beforeEach(() => {
      tenantZone = "Europe/Berlin";
      // 23:30 UTC on 31.12. is 00:30 on 01.01. in Europe/Berlin
      vi.setSystemTime(new Date("2026-12-31T23:30:00.000Z"));
    });

    it("anti-vacuity: the device is on the old year", () => {
      expect(new Date().getFullYear()).toBe(2026);
      expect(new Date().getDate()).toBe(31);
    });

    it("T1 opens on the tenant's month, holidays year, today marker and selected day", async () => {
      await mount();
      await waitFor(() => expect(monthRequests().length).toBeGreaterThan(0));
      expect(paths()).toContain("/time-entries?from=2027-01-01&to=2027-01-31");
      expect(paths()).toContain("/holidays?year=2027");
      expect(paths().some((p) => p.startsWith("/time-entries?from=2026-12-01"))).toBe(false);
      expect((await cell("2027-01-01")).className).toContain("cal-today");
      expect((await cell("2027-01-01")).className).toContain("cal-selected");
      expect((await cell("2026-12-31")).className).not.toContain("cal-today");
    });

    it("T4 „Heute“ comes back to the tenant day", async () => {
      await mount();
      await waitFor(() => expect(monthRequests().length).toBeGreaterThan(0));
      await fireEvent.click(screen.getByTestId("calendar-month-header-prev"));
      await waitFor(() => expect(monthRequests().at(-1)).toContain("from=2026-12-01"));
      await fireEvent.click(screen.getByTestId("calendar-month-header-today"));
      await waitFor(() =>
        expect(monthRequests().at(-1)).toBe("/time-entries?from=2027-01-01&to=2027-01-31"),
      );
      const jan1 = await cell("2027-01-01");
      await waitFor(() => {
        expect(jan1.className).toContain("cal-today");
        expect(jan1.className).toContain("cal-selected");
      });
    });
  });

  describe("a tenant that is not in Berlin", () => {
    withProcessZone("UTC");

    beforeEach(() => {
      tenantZone = "America/New_York";
      // 03:00 UTC on 01.12. is 22:00 on 30.11. in New York
      vi.setSystemTime(new Date("2026-12-01T03:00:00.000Z"));
    });

    it("T2 the zone comes from the tenant settings", async () => {
      await mount();
      await waitFor(() => expect(monthRequests().length).toBeGreaterThan(0));
      expect(paths()).toContain("/time-entries?from=2026-11-01&to=2026-11-30");
      expect((await cell("2026-11-30")).className).toContain("cal-today");
    });

    it("T5 a cold store: the page awaits the zone before its first month request", async () => {
      // a fresh module graph: the singleton store has never read /settings/work
      vi.resetModules();
      const freshStore = (await import("$stores/tenant-features")).tenantFeatures;
      expect(freshStore.peek().loaded).toBe(false);
      const fresh = await import("@testing-library/svelte");
      const { renderWithTheme: freshRender } = await import("$tests/test-utils");
      const Page = (await import("../routes/(app)/time-entries/+page.svelte")).default;
      freshRender(Page, {});
      await waitFor(() => expect(monthRequests().length).toBeGreaterThan(0));
      const calls = paths();
      expect(monthRequests()[0]).toBe("/time-entries?from=2026-11-01&to=2026-11-30");
      expect(calls.indexOf("/settings/work")).toBeGreaterThan(-1);
      expect(calls.indexOf("/settings/work")).toBeLessThan(
        calls.findIndex((p) => p.startsWith("/time-entries?from=")),
      );
      fresh.cleanup();
    });
  });

  describe("a device that is a day ahead of the tenant", () => {
    withProcessZone("Pacific/Kiritimati");

    beforeEach(() => {
      tenantZone = "Europe/Berlin";
      // 10:30 UTC on 24.11.: 00:30 on 25.11. on the device (UTC+14), still the 24th in Berlin
      vi.setSystemTime(new Date("2026-11-24T10:30:00.000Z"));
    });

    it("T3 marks the tenant's day, not the device's", async () => {
      expect(new Date().getDate()).toBe(25);
      await mount();
      expect((await cell("2026-11-24")).className).toContain("cal-today");
      expect((await cell("2026-11-25")).className).not.toContain("cal-today");
    });
  });
});
