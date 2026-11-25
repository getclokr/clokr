// Issue #1066 - Mein Tag decides "today" in the TENANT zone, never from the browser date.
//
// The server files a clock stamp under the tenant day (`dateStrInTz(now, tz)`). A device whose zone
// shows another calendar day used to ask `GET /time-entries?from=<browser day>&to=<browser day>`,
// got none of today's rows, and the stage fell back to "Noch nicht eingestempelt" with the "Pause"
// button gone. These cases mount the real dashboard page with the process time zone switched and the
// clock faked around the boundary hour, and serve the rows by exact URL: only the tenant-day request
// finds the entry, so a page that still reads the browser date fails here.
const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock("$app/navigation", () => ({
  goto: vi.fn(),
  afterNavigate: vi.fn(),
  replaceState: vi.fn(),
}));

vi.mock("$stores/auth", async () => {
  const { writable } = await import("svelte/store");
  return { authStore: writable({ user: null }) };
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
      post: (...args: unknown[]) => apiPost(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock("$lib/utils/logger", () => ({
  clientLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("chart.js", () => {
  class Chart {
    static register = vi.fn();
    static defaults = { font: {}, plugins: {} };
    destroy() {}
    update() {}
  }
  const stub = class {};
  return {
    Chart,
    BarController: stub,
    LineController: stub,
    DoughnutController: stub,
    BarElement: stub,
    LineElement: stub,
    PointElement: stub,
    ArcElement: stub,
    CategoryScale: stub,
    LinearScale: stub,
    Tooltip: stub,
    Legend: stub,
    Filler: stub,
  };
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { format } from "date-fns";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import { ApiError } from "$api/client";
import { toasts } from "$stores/toast";
import { tenantFeatures } from "$stores/tenant-features";
import DashboardPage from "../routes/(app)/dashboard/+page.svelte";

const ENTRY_ID = "5d1c7e2a-3b4f-4c8d-9e0a-1b2c3d4e5f60";
const NO_CHOICE = { offerChoice: false, preselectedSalonId: null, salons: [], fixedSalon: null };

interface Entry {
  id: string;
  date: string;
  startTime: string;
  endTime: string | null;
  breakMinutes: number;
  breakStartedAt?: string | null;
}

/** What the fake server knows: the tenant zone, the tenant's today, and its rows. */
interface World {
  tenantZone: string;
  tenantDay: string;
  /** The rows of the tenant day, served only for exactly that day's URL. */
  entries: Entry[];
  /** The open entry the clock acts on, `null` = none. */
  clockEntry: Entry | null;
}

let world: World;

const dayUrl = (day: string) => `/time-entries?from=${day}&to=${day}`;

function serve() {
  apiGet.mockImplementation((path: string) => {
    if (path === "/settings/work") {
      return Promise.resolve({ timezone: world.tenantZone, availabilityEnabled: true });
    }
    if (path === "/time-entries/clock-salon") return Promise.resolve(NO_CHOICE);
    if (path === "/time-entries/clock-state") {
      return Promise.resolve({ entry: world.clockEntry, crossDay: false });
    }
    if (path === dayUrl(world.tenantDay)) return Promise.resolve(world.entries);
    if (path.startsWith("/time-entries?")) return Promise.resolve([]);
    if (path === "/me/context") {
      return Promise.resolve({
        tenant: { id: "t1", name: "Mandant" },
        isMultiSalon: false,
        homeSalonId: null,
        salons: [],
      });
    }
    return Promise.reject(new ApiError(404, "not part of this test"));
  });
}

const getPaths = () => apiGet.mock.calls.map((c) => c[0] as string);
/** Every request for a day's rows ("/time-entries?from=…"). */
const entryReads = (from = 0) =>
  getPaths()
    .slice(from)
    .filter((p) => p.startsWith("/time-entries?from="));

const runningEntry = (day: string, startIso: string): Entry => ({
  id: ENTRY_ID,
  date: `${day}T00:00:00.000Z`,
  startTime: startIso,
  endTime: null,
  breakMinutes: 0,
  breakStartedAt: null,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until the page's onMount has finished loading, i.e. the poll is registered. */
async function settled() {
  await waitFor(() => expect(getPaths()).toContain("/activity?limit=5"));
  await sleep(40);
}

let success: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  try {
    localStorage.clear();
  } catch {
    /* no storage in this environment; the page tolerates it */
  }
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.spyOn(console, "error").mockImplementation(() => {});
  success = vi.spyOn(toasts, "success").mockReturnValue(crypto.randomUUID());
  vi.spyOn(toasts, "error").mockReturnValue(crypto.randomUUID());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Switches the process zone for one describe and restores it afterwards (as deep-link.test.ts does). */
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

describe("Mein Tag on a device whose zone is another calendar day than the tenant's (#1066)", () => {
  withProcessZone("UTC");

  // 23:30 UTC on the 24th is 00:30 on the 25th in Europe/Berlin (CET, UTC+1).
  const NOW = new Date("2026-11-24T23:30:00.000Z");
  const STARTED = "2026-11-24T23:10:00.000Z";

  beforeEach(() => {
    vi.setSystemTime(NOW);
    world = {
      tenantZone: "Europe/Berlin",
      tenantDay: "2026-11-25",
      entries: [],
      clockEntry: null,
    };
    serve();
  });

  async function mount() {
    // The (app) layout reads the zone once per mount; here the test plays that part.
    await tenantFeatures.fetch();
    renderWithTheme(DashboardPage, {});
  }

  it("anti-vacuity: the device day really is the day before the tenant day", () => {
    expect(format(new Date(), "yyyy-MM-dd")).toBe("2026-11-24");
    expect(world.tenantDay).toBe("2026-11-25");
  });

  it("T1: first load asks for the tenant day and shows the running entry with Pause", async () => {
    const entry = runningEntry("2026-11-25", STARTED);
    world.entries = [entry];
    world.clockEntry = entry;
    await mount();

    await waitFor(() =>
      expect(screen.getByTestId("clock-state")).toHaveTextContent("Du arbeitest"),
    );
    expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();
    expect(entryReads()).toContain(dayUrl("2026-11-25"));
    expect(entryReads()).not.toContain(dayUrl("2026-11-24"));
  });

  it("T2: Einstempeln - the reload after the clock-in asks for the tenant day", async () => {
    const entry = runningEntry("2026-11-25", STARTED);
    apiPost.mockImplementation((path: string) => {
      expect(path).toBe("/time-entries/clock-in");
      world.entries = [entry];
      world.clockEntry = entry;
      return Promise.resolve({
        resolution: {
          kind: "CLOCKED_IN",
          entry: { ...entry, employeeId: "e1", source: "MOBILE" },
        },
      });
    });
    await mount();

    await fireEvent.click(await screen.findByRole("button", { name: "Einstempeln" }));
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(entryReads().filter((p) => p === dayUrl("2026-11-25"))).toHaveLength(2),
    );

    await waitFor(() =>
      expect(screen.getByTestId("clock-state")).toHaveTextContent("Du arbeitest"),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled());
    expect(entryReads()).not.toContain(dayUrl("2026-11-24"));
  });

  it("T3: Pause - every entries read after the break request is the tenant day", async () => {
    const entry = runningEntry("2026-11-25", STARTED);
    world.entries = [entry];
    world.clockEntry = entry;
    apiPost.mockImplementation((path: string, body: { action: string }) => {
      expect(path).toBe(`/time-entries/${ENTRY_ID}/break`);
      entry.breakStartedAt = body.action === "start" ? NOW.toISOString() : null;
      return Promise.resolve({ breakStartedAt: entry.breakStartedAt, breakMinutes: 0 });
    });
    await mount();

    const pause = await screen.findByRole("button", { name: "Pause" });
    await waitFor(() => expect(pause).toBeEnabled());
    const mark = apiGet.mock.calls.length;
    await fireEvent.click(pause);

    expect(await screen.findByRole("button", { name: "Weiterarbeiten" })).toBeInTheDocument();
    const after = entryReads(mark);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((p) => p === dayUrl("2026-11-25"))).toBe(true);
  });

  it("T4: the visible poll asks for the tenant day", async () => {
    const entry = runningEntry("2026-11-25", STARTED);
    world.entries = [entry];
    world.clockEntry = entry;
    await mount();
    await settled();

    const mark = apiGet.mock.calls.length;
    await waitFor(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      expect(entryReads(mark).length).toBeGreaterThan(0);
    });
    expect(entryReads(mark).every((p) => p === dayUrl("2026-11-25"))).toBe(true);
    expect(screen.getByTestId("clock-state")).toHaveTextContent("Du arbeitest");
  });
});

describe("the zone is read from the tenant, not assumed (#1066)", () => {
  withProcessZone("Europe/Berlin");

  it("T5: a New York tenant on a Berlin device is asked for the New York day", async () => {
    // 03:30 UTC on the 25th: Berlin 04:30 on the 25th, New York 22:30 on the 24th.
    vi.setSystemTime(new Date("2026-11-25T03:30:00.000Z"));
    world = {
      tenantZone: "America/New_York",
      tenantDay: "2026-11-24",
      entries: [],
      clockEntry: null,
    };
    serve();
    expect(format(new Date(), "yyyy-MM-dd")).toBe("2026-11-25");

    await tenantFeatures.fetch();
    renderWithTheme(DashboardPage, {});
    await settled();

    expect(entryReads()).toContain(dayUrl("2026-11-24"));
    expect(entryReads()).not.toContain(dayUrl("2026-11-25"));
  });
});
