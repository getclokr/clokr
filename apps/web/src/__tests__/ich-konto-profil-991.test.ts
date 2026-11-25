// Issue #991 (N-24, N-25, N-26) — Ich › Konto speaks plainly about a closed month, Ich › Profil
// names the vacation entitlement of the year and the WLAN words are plain. The Konto and Profil
// pages need many GETs to mount, so their wording is pinned by source reads; the figure label of
// „Meine Arbeit“ is mounted for real with a mocked API.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";

const get = vi.hoisted(() => vi.fn());

vi.mock("$api/client", () => ({ api: { get } }));
vi.mock("$stores/auth", async () => {
  const { writable } = await import("svelte/store");
  return { authStore: writable({ user: { employeeId: "emp-1" } }) };
});
vi.mock("$stores/salon-context", async () => {
  const { writable } = await import("svelte/store");
  return { salonContext: writable({ homeSalonId: null, salons: [] }) };
});
vi.mock("$stores/tenant-features", () => ({
  tenantFeatures: { loadTimezone: async () => "Europe/Berlin" },
}));

import MyWorkSettings from "$lib/components/settings/MyWorkSettings.svelte";

function serve(hireDate: string, total: number, exitDate: string | null = null) {
  get.mockImplementation(async (url: string) => {
    if (url.startsWith("/leave/entitlements/")) {
      return [
        {
          typeCode: "VACATION",
          leaveType: { name: "Urlaub" },
          totalDays: total,
          usedDays: 0,
          carriedOverDays: 0,
          effectiveCarryOverDays: 0,
          carryOverDeadline: null,
        },
      ];
    }
    return {
      hireDate,
      exitDate,
      workSchedule: {
        id: "ws-1",
        type: "FIXED_SCHEDULE",
        validFrom: "2026-10-01T00:00:00.000Z",
        weeklyHours: 20,
        workDays: [2, 3, 4, 5],
      },
    };
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Profil › Meine Arbeit names the vacation entitlement of the year (N-25, D-991-24)", () => {
  it("labels the figure with the year and marks a join within that year as pro rata", async () => {
    serve("2026-10-01T00:00:00.000Z", 6);
    renderWithTheme(MyWorkSettings, {});
    expect(await screen.findByText("Urlaubsanspruch 2026")).toBeInTheDocument();
    expect(screen.getByText("6 Tage (anteilig ab 1.10.)")).toBeInTheDocument();
    expect(screen.queryByText("Urlaub pro Jahr")).not.toBeInTheDocument();
  });

  it("shows no „anteilig“ for a person who joined in an earlier year", async () => {
    serve("2024-03-01T00:00:00.000Z", 26);
    renderWithTheme(MyWorkSettings, {});
    expect(await screen.findByText("26 Tage")).toBeInTheDocument();
    expect(screen.queryByText(/anteilig/)).not.toBeInTheDocument();
  });

  it("says „1 Tag“ for a single day and keeps a decimal comma", async () => {
    serve("2024-03-01T00:00:00.000Z", 1);
    const first = renderWithTheme(MyWorkSettings, {});
    expect(await screen.findByText("1 Tag")).toBeInTheDocument();
    first.unmount();
    serve("2024-03-01T00:00:00.000Z", 6.5);
    renderWithTheme(MyWorkSettings, {});
    expect(await screen.findByText("6,5 Tage")).toBeInTheDocument();
  });

  it("marks an exit within the year as pro rata until that day", async () => {
    serve("2024-03-01T00:00:00.000Z", 20, "2026-09-30T00:00:00.000Z");
    renderWithTheme(MyWorkSettings, {});
    expect(await screen.findByText("20 Tage (anteilig bis 30.9.)")).toBeInTheDocument();
  });

  it("shows the contract start as „seit 1.10.2026“, without a leading zero", async () => {
    serve("2026-10-01T00:00:00.000Z", 6);
    renderWithTheme(MyWorkSettings, {});
    await waitFor(() => expect(screen.getByText("seit 1.10.2026")).toBeInTheDocument());
  });
});

const read = (rel: string) => readFileSync(resolve(__dirname, "..", rel), "utf8");

describe("Konto, WLAN and photo wording (source pins)", () => {
  const konto = read("routes/(app)/ich/konto/+page.svelte");
  const wifi = read("lib/components/settings/WifiPresenceSettings.svelte");
  const settings = read("routes/(app)/settings/+page.svelte");

  it("Konto: a closed month is explained in plain words and names its exception in the hint", () => {
    expect(konto).toContain("Dieser Monat ist abgeschlossen. Seine Tage findest du unter");
    expect(konto).not.toContain("Der Monat ist abgeschlossen; gespeichert sind seine Monatswerte");
    expect(konto).toContain("Bei einem abgeschlossenen Monat führt dich der Link zu Zeiten.");
  });

  it("Konto: the status chip tone is read from the one month-status module", () => {
    expect(konto).toContain("MONTH_STATUS_TONE");
    expect(konto).not.toMatch(/=== "CLOSED" \? "ok" : "info"/);
  });

  it("WLAN: the manual entry reads „Handy ohne QR-Code koppeln“ with a plain field name", () => {
    expect(wifi).toContain("Handy ohne QR-Code koppeln");
    expect(wifi).not.toContain("MAC-Adresse manuell eintragen");
    expect(wifi).toContain("WLAN-Adresse deines Handys");
    expect(wifi).toContain("InfoHint");
  });

  it("Profil: the photo line names only the formats", () => {
    expect(settings).toContain("JPG, PNG oder WebP.");
    expect(settings).not.toContain("Tippe auf das Bild");
  });
});
