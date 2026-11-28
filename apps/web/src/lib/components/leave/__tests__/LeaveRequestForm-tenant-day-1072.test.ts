// Issue #1072 - the leave form reads the entitlement year and "is the carry-over deadline still
// ahead" in the TENANT zone. The real form is mounted with the process zone switched and Date
// faked, so the device and the tenant stand on different calendar days or years (New Year in Berlin
// while the device is still on 31.12. UTC; a New York tenant on a Berlin device).
const apiGet = vi.fn();
vi.mock("$api/client", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import LeaveRequestForm from "../LeaveRequestForm.svelte";
import { tenantFeatures } from "$stores/tenant-features";

const EMPLOYEE_ID = "emp-1";

let world = { zone: "Europe/Berlin", carryOverDeadline: null as string | null };

function serve() {
  apiGet.mockImplementation((path: string) => {
    if (path === "/settings/work") {
      return Promise.resolve({ timezone: world.zone, availabilityEnabled: true });
    }
    if (path.startsWith("/leave/entitlements/")) {
      return Promise.resolve([
        {
          typeCode: "VACATION",
          leaveType: { name: "Urlaub" },
          totalDays: 30,
          usedDays: 5,
          carriedOverDays: 3,
          effectiveCarryOverDays: 3,
          carryOverDeadline: world.carryOverDeadline,
          provisionalUsedDays: 0,
        },
      ]);
    }
    if (path.startsWith("/leave/overtime-balance")) {
      return Promise.resolve({
        balanceHours: 4,
        confirmedMinutes: 240,
        openMonthMinutes: null,
        hasClosedMonth: true,
        maxNegativeBalanceMinutes: null,
        isNegativeLimitExceeded: false,
      });
    }
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  apiGet.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Switches the process zone for one describe and restores it afterwards. */
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

async function mountForm(props: Record<string, unknown> = {}) {
  // The (app) layout reads the zone once; here the test plays that part and refreshes the singleton.
  await tenantFeatures.fetch();
  return renderWithTheme(LeaveRequestForm, {
    open: true,
    employeeId: EMPLOYEE_ID,
    editingRequest: null,
    onSaved: vi.fn(),
    ...props,
  } as never);
}

function entitlementPaths(): string[] {
  return apiGet.mock.calls
    .map((call) => String(call[0]))
    .filter((path) => path.startsWith("/leave/entitlements/"));
}

describe("the leave form on a device that is on another year than the tenant (#1072)", () => {
  withProcessZone("UTC");

  // 23:30 UTC on 31.12. is 00:30 on 01.01. in Europe/Berlin (CET, UTC+1).
  const NOW = new Date("2026-12-31T23:30:00.000Z");

  beforeEach(() => {
    vi.setSystemTime(NOW);
    world = { zone: "Europe/Berlin", carryOverDeadline: null };
    serve();
  });

  it("anti-vacuity: the device really is in the old year", () => {
    expect(new Date().getFullYear()).toBe(2026);
  });

  it("asks the entitlements of the tenant year when no entitlementYear is given", async () => {
    await mountForm();
    await waitFor(() => expect(entitlementPaths().length).toBeGreaterThan(0));
    expect(entitlementPaths()).toContain(`/leave/entitlements/${EMPLOYEE_ID}?year=2027`);
    expect(entitlementPaths().some((path) => path.endsWith("year=2026"))).toBe(false);
  });

  it("lets the entitlementYear prop win over the tenant year", async () => {
    await mountForm({ entitlementYear: 2026 });
    await waitFor(() => expect(entitlementPaths().length).toBeGreaterThan(0));
    expect(entitlementPaths()).toContain(`/leave/entitlements/${EMPLOYEE_ID}?year=2026`);
    expect(entitlementPaths().some((path) => path.endsWith("year=2027"))).toBe(false);
  });

  it("shows no expiry for a deadline that ended on the tenant's yesterday", async () => {
    world.carryOverDeadline = "2026-12-31";
    await mountForm();
    await screen.findByText(/Übertrag Vorjahr/);
    expect(screen.queryByText(/verfällt/)).toBeNull();
  });

  it("shows the expiry of a deadline on the tenant's today", async () => {
    world.carryOverDeadline = "2027-01-01";
    await mountForm();
    expect(await screen.findByText("(verfällt 1.1.2027)")).toBeTruthy();
  });
});

describe("the leave form of a New York tenant on a Berlin device (#1072)", () => {
  withProcessZone("Europe/Berlin");

  // 03:00 UTC on 01.01. is 04:00 in Berlin (2027) but 22:00 on 31.12. in New York (2026).
  const NOW = new Date("2027-01-01T03:00:00.000Z");

  beforeEach(() => {
    vi.setSystemTime(NOW);
    world = { zone: "America/New_York", carryOverDeadline: null };
    serve();
  });

  it("anti-vacuity: the device really is in the new year", () => {
    expect(new Date().getFullYear()).toBe(2027);
  });

  it("asks the entitlements of the tenant's year, not the device's", async () => {
    await mountForm();
    await waitFor(() => expect(entitlementPaths().length).toBeGreaterThan(0));
    expect(entitlementPaths()).toContain(`/leave/entitlements/${EMPLOYEE_ID}?year=2026`);
    expect(entitlementPaths().some((path) => path.endsWith("year=2027"))).toBe(false);
  });
});
