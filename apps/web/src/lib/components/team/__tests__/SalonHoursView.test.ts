// Issue #1030 - the mountable Salonansicht hours raster. The route page cannot be mounted ($app
// imports and a dozen requests on mount), so the component carries the rendering contract. The
// component sums nothing: every figure on screen is a figure the server sent.
import { afterEach, describe, expect, it, vi } from "vitest";

// The shared heading text comes from page-scope, which pulls in the api client, the auth store and
// its localStorage bootstrap; a stand-in (as in team-view.test.ts) keeps this file free of that.
vi.mock("$api/client", () => ({
  api: { get: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock("$lib/utils/logger", () => ({ clientLogger: { warn: vi.fn(), error: vi.fn() } }));
import { cleanup, fireEvent, screen } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import SalonHoursView from "../SalonHoursView.svelte";
import type { SalonHoursCell, SalonHoursResponse, SalonPeriod } from "$lib/team/salon-hours";

afterEach(() => cleanup());

const DAYS = [
  "2026-11-23",
  "2026-11-24",
  "2026-11-25",
  "2026-11-26",
  "2026-11-27",
  "2026-11-28",
  "2026-11-29",
];

function cells(minutes: number[], states: Record<string, Partial<SalonHoursCell>> = {}) {
  return DAYS.map((date, i): SalonHoursCell => ({
    date,
    minutes: minutes[i] ?? 0,
    counted: i <= 1,
    elsewhere: [],
    elsewhereHidden: false,
    absent: false,
    open: false,
    ...states[date],
  }));
}

// The totals are deliberately NOT the sum of the cells: a component that summed would show 8:00.
const DATA: SalonHoursResponse = {
  salonId: "s1",
  salonName: "Salon Nord",
  period: "week",
  from: "2026-11-23",
  to: "2026-11-29",
  days: DAYS,
  countedThrough: "2026-11-24",
  kpis: { salonWorkedMinutes: 1234, stammteamMinutes: 1000, aushilfenMinutes: 234, openCount: 2 },
  stammteam: {
    rows: [
      {
        employeeId: "e1",
        employeeName: "Anna Berg",
        employeeNumber: "1001",
        totalMinutes: 555,
        cells: cells([480, 0], {
          "2026-11-24": { elsewhere: [{ salonId: "s2", salonName: "Salon Süd" }] },
          "2026-11-25": { absent: true },
        }),
      },
      {
        employeeId: "e2",
        employeeName: "Bernd Adler",
        employeeNumber: null,
        totalMinutes: 0,
        cells: cells([], { "2026-11-24": { elsewhereHidden: true } }),
      },
    ],
    dayTotals: [777, 0, 0, 0, 0, 0, 0],
    totalMinutes: 999,
  },
  aushilfen: {
    rows: [
      {
        employeeId: "h1",
        employeeName: "Carla Gast",
        employeeNumber: null,
        totalMinutes: 234,
        cells: cells([234]),
        homeSalonId: "s2",
        homeSalonName: "Salon Süd",
      },
      {
        employeeId: "h2",
        employeeName: "Dora Frei",
        employeeNumber: null,
        totalMinutes: 0,
        cells: cells([]),
        homeSalonId: null,
        homeSalonName: null,
      },
    ],
    dayTotals: [321, 0, 0, 0, 0, 0, 0],
    totalMinutes: 234,
  },
  open: [
    { employeeId: "e1", employeeName: "Anna Berg", date: "2026-11-23", startTime: "09:00" },
    { employeeId: "e2", employeeName: "Bernd Adler", date: "2026-11-24", startTime: "08:30" },
  ],
  exchange: {
    // The minutes are the server's; 150 + 90 deliberately differ from the helper block total.
    fromOtherSalons: [
      {
        salonId: "s2",
        salonName: "Salon Süd",
        persons: 1,
        minutes: 150,
        people: [
          { employeeId: "h1", employeeName: "Carla Gast", employeeNumber: null, minutes: 150 },
        ],
      },
      { salonId: null, salonName: null, persons: 1, minutes: 90, people: [] },
    ],
    ownTeamElsewhere: [
      { salonId: "s2", salonName: "Salon Süd", persons: 2, minutes: 600, people: [] },
    ],
  },
};

const PERIOD: SalonPeriod = { zoom: "woche", anchor: "2026-11-23" };

function render(props: Record<string, unknown> = {}) {
  return renderWithTheme(SalonHoursView, {
    status: "ready",
    data: DATA,
    period: PERIOD,
    todayStr: "2026-11-25",
    onPeriodChange: () => {},
    ...props,
  });
}

describe("SalonHoursView - states", () => {
  it("asks for a salon in the header when none is chosen", () => {
    render({ status: "prompt", data: null });
    expect(
      screen.getByText(/Wähl in der Kopfleiste einen Salon, um seine Stunden zu sehen/),
    ).toBeTruthy();
    expect(screen.queryByTestId("salon-hours-stammteam")).toBeNull();
  });

  it("answers a rejected salon with a calm text", () => {
    render({ status: "rejected", data: null });
    expect(screen.getByText(/Für diesen Salon liegt keine Salonansicht vor/)).toBeTruthy();
    expect(screen.queryByTestId("salon-hours-stammteam")).toBeNull();
  });

  it("shows no table while loading and keeps the period control", () => {
    render({ status: "loading", data: null, salonName: "Salon Nord" });
    expect(screen.queryByTestId("salon-hours-stammteam")).toBeNull();
    expect(screen.getByText("Salon Nord")).toBeTruthy();
    expect(screen.getByTestId("salon-hours-period")).toBeTruthy();
  });

  it("shows the error with a retry", async () => {
    const onRetry = vi.fn();
    render({ status: "error", data: null, onRetry, errorMessage: "Nicht geladen." });
    expect(screen.getByRole("alert").textContent).toContain("Nicht geladen.");
    await fireEvent.click(screen.getByRole("button", { name: /noch einmal|Erneut|versuchen/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("SalonHoursView - ready", () => {
  it("names the salon, carries the person-figures hint and offers week and month", () => {
    render();
    expect(screen.getByTestId("salon-hours-title").textContent).toBe("Salon Nord");
    expect(screen.getByTestId("salon-hours-person-figures-hint").textContent).toBe(
      "Soll, Saldo und Überstunden gehören zur Person, nicht zum Salon. Du findest sie in der Personenansicht.",
    );
    expect(screen.getByTestId("salon-hours-period-label").textContent).toContain(
      "KW 48 · 23.–29.11.2026",
    );
    expect(screen.getByRole("radio", { name: "Woche" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Monat" })).toBeTruthy();
  });

  it("shows the KPI Stunden im Salon with its Stichtag and the server's figure", () => {
    render();
    const kpi = screen.getByTestId("salon-hours-kpi-total");
    expect(kpi.textContent).toContain("Stunden im Salon");
    expect(kpi.textContent).toContain("20:34");
    expect(kpi.textContent).toContain("bis Di, 24.11.2026");
  });

  it("renders one Stammteam row per server row with the cell hours", () => {
    const { container } = render();
    const table = screen.getByTestId("salon-hours-stammteam");
    const bodyRows = table.querySelectorAll("tbody tr");
    expect(bodyRows).toHaveLength(2);
    expect(bodyRows[0].textContent).toContain("Anna Berg");
    expect(bodyRows[0].textContent).toContain("1001");
    expect(bodyRows[0].textContent).toContain("8:00");
    expect(bodyRows[1].textContent).toContain("Bernd Adler");
    expect(container.querySelector("th[title='Montag, 23.11.2026']")?.textContent).toBe("Mo 23.");
  });

  it("shows the server's totals and sums nothing itself", () => {
    render();
    const table = screen.getByTestId("salon-hours-stammteam");
    const row = table.querySelector("tbody tr")!;
    // totalMinutes 555 = 9:15, while the cells add up to 8:00.
    expect(row.textContent).toContain("9:15");
    const foot = table.querySelector("tfoot tr")!;
    expect(foot.textContent).toContain("Summe je Tag");
    // 777 = 12:57 and 999 = 16:39 are the server's, not the cell sums.
    expect(foot.textContent).toContain("12:57");
    expect(foot.textContent).toContain("16:39");
    expect(foot.textContent).not.toContain("8:00");
  });

  it("reads a counted day without hours as a dash and a day not counted yet as empty", () => {
    render();
    const cellsOfFirst = [
      ...screen.getByTestId("salon-hours-stammteam").querySelectorAll("tbody tr:nth-child(2) td"),
    ];
    // person, 7 days, sum
    expect(cellsOfFirst).toHaveLength(9);
    expect(cellsOfFirst[1].textContent?.trim()).toBe("–");
    // Bernd's 24.11. also carries the neutral „anderer Salon“ chip next to the dash.
    expect(cellsOfFirst[2].textContent).toContain("–");
    expect(cellsOfFirst[3].textContent?.trim()).toBe("");
  });

  it("names the Stichtag in the sum column and mentions no Soll or saldo anywhere", () => {
    render();
    expect(screen.getAllByText(/Summe bis Di, 24.11.2026/).length).toBeGreaterThan(0);
    const visible = (document.body.textContent ?? "").replace(
      "Soll, Saldo und Überstunden gehören zur Person, nicht zum Salon. Du findest sie in der Personenansicht.",
      "",
    );
    expect(visible).not.toMatch(/Soll|Saldo|Überstunden/);
  });

  it("moves the period through the callbacks and disables a next arrow into the future", async () => {
    const onPeriodChange = vi.fn();
    render({ onPeriodChange });
    await fireEvent.click(screen.getByTestId("salon-hours-period-prev"));
    expect(onPeriodChange).toHaveBeenLastCalledWith({ zoom: "woche", anchor: "2026-11-16" });
    const next = screen.getByTestId("salon-hours-period-next") as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    await fireEvent.click(screen.getByRole("radio", { name: "Monat" }));
    expect(onPeriodChange).toHaveBeenLastCalledWith({ zoom: "monat", anchor: "2026-11-01" });
  });
});

describe("SalonHoursView - Aushilfen", () => {
  it("lists the helpers in their own block under the shared heading, with the Stammsalon", () => {
    render();
    expect(screen.getByRole("heading", { name: "Aushilfen aus anderen Salons" })).toBeTruthy();
    const table = screen.getByTestId("salon-hours-aushilfen");
    const bodyRows = table.querySelectorAll("tbody tr");
    expect(bodyRows).toHaveLength(2);
    expect(bodyRows[0].textContent).toContain("Carla Gast");
    expect(bodyRows[0].textContent).toContain("Salon Süd");
    expect(bodyRows[1].textContent).toContain("ohne Stammsalon");
    const heads = [...table.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(heads.slice(0, 2)).toEqual(["Person", "Stammsalon"]);
    // The helper block carries its own server totals in its own footer.
    expect(table.querySelector("tfoot")!.textContent).toContain("5:21");
    // No helper appears in the Stammteam block and vice versa.
    expect(screen.getByTestId("salon-hours-stammteam").textContent).not.toContain("Carla Gast");
  });

  it("says so when no helper worked in the salon, and renders no helper table", () => {
    render({
      data: { ...DATA, aushilfen: { rows: [], dayTotals: [0, 0, 0, 0, 0, 0, 0], totalMinutes: 0 } },
    });
    expect(screen.getByTestId("salon-hours-no-helpers").textContent).toContain(
      "Keine Aushilfen aus anderen Salons in diesem Zeitraum.",
    );
    expect(screen.queryByTestId("salon-hours-aushilfen")).toBeNull();
  });

  it("shows the KPI Aushilfen next to Stammteam", () => {
    render();
    expect(screen.getByTestId("salon-hours-kpi-aushilfen").textContent).toContain("3:54");
    expect(screen.getByTestId("salon-hours-kpi-stammteam").textContent).toContain("16:40");
  });
});

describe("SalonHoursView - cell states", () => {
  it("shows „in <Salon>“, „anderer Salon“ and „abwesend“ as chips", () => {
    render();
    const table = screen.getByTestId("salon-hours-stammteam");
    const anna = table.querySelectorAll("tbody tr")[0];
    expect(anna.textContent).toContain("in Salon Süd");
    expect(anna.textContent).toContain("abwesend");
    const bernd = table.querySelectorAll("tbody tr")[1];
    expect(bernd.textContent).toContain("anderer Salon");
    // The hidden mark carries no salon: nothing but the neutral text.
    expect(bernd.textContent).not.toContain("Salon Süd");
  });

  it("names no kind of absence anywhere", () => {
    render();
    expect(document.body.textContent ?? "").not.toMatch(/Urlaub|Krank|Berufsschule|Elternzeit/);
  });
});

describe("SalonHoursView - cell click", () => {
  it("makes the cells of a clickable person buttons named with their state and opens the day", async () => {
    const onCellOpen = vi.fn();
    render({ clickableIds: new Set(["e1"]), onCellOpen });
    const table = screen.getByTestId("salon-hours-stammteam");
    const buttons = table.querySelectorAll("tbody tr:nth-child(1) button");
    expect(buttons).toHaveLength(7);
    expect(buttons[0].getAttribute("aria-label")).toBe(
      "Anna Berg, Montag, 23.11.2026: 8:00 im Salon",
    );
    expect(buttons[1].getAttribute("aria-label")).toContain("in Salon Süd");
    await fireEvent.click(buttons[0]);
    expect(onCellOpen).toHaveBeenCalledWith("e1", "2026-11-23");
    await fireEvent.click(buttons[2]);
    expect(onCellOpen).toHaveBeenLastCalledWith("e1", "2026-11-25");
  });

  it("renders plain text cells for a person the caller cannot open", () => {
    const onCellOpen = vi.fn();
    render({ clickableIds: new Set(["e1"]), onCellOpen });
    const bernd = screen
      .getByTestId("salon-hours-stammteam")
      .querySelectorAll("tbody tr:nth-child(2) button");
    expect(bernd).toHaveLength(0);
    const helpers = screen.getByTestId("salon-hours-aushilfen").querySelectorAll("button");
    expect(helpers).toHaveLength(0);
  });

  it("makes no cell a button without clickable ids", () => {
    render();
    expect(
      screen.getByTestId("salon-hours-stammteam").querySelectorAll("tbody button"),
    ).toHaveLength(0);
  });
});

describe("SalonHoursView - open items (Issue #1030)", () => {
  it("shows the KPI Offen with the server's count", () => {
    render();
    const kpi = screen.getByTestId("salon-hours-kpi-open");
    expect(kpi.textContent).toContain("Offen");
    expect(kpi.textContent).toContain("2");
  });

  it("marks the cell of a missing clock-out with the chip „offen“", () => {
    const marked = {
      ...DATA,
      stammteam: {
        ...DATA.stammteam,
        rows: DATA.stammteam.rows.map((row) =>
          row.employeeId === "e1"
            ? {
                ...row,
                cells: row.cells.map((c) => (c.date === "2026-11-23" ? { ...c, open: true } : c)),
              }
            : row,
        ),
      },
    };
    render({ data: marked });
    const anna = screen.getByTestId("salon-hours-stammteam").querySelectorAll("tbody tr")[0];
    expect(anna.querySelectorAll("td")[1].textContent).toContain("offen");
  });

  it("lists each open item with the day and the start time under the heading", () => {
    render();
    expect(screen.getByRole("heading", { name: "Offen in diesem Salon" })).toBeTruthy();
    const list = screen.getByTestId("salon-hours-open-list");
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Anna Berg");
    expect(items[0].textContent).toContain("Mo, 23.11. · seit 09:00");
    expect(items[1].textContent).toContain("Bernd Adler");
    expect(items[1].textContent).toContain("Di, 24.11. · seit 08:30");
  });

  it("opens the person's day from an item of a clickable person only", async () => {
    const onCellOpen = vi.fn();
    render({ clickableIds: new Set(["e1"]), onCellOpen });
    const list = screen.getByTestId("salon-hours-open-list");
    const buttons = list.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    await fireEvent.click(buttons[0]);
    expect(onCellOpen).toHaveBeenCalledWith("e1", "2026-11-23");
  });

  it("links to the Aufgaben only when the caller may open them", () => {
    const first = render();
    expect(first.queryByText("Zu den Aufgaben")).toBeNull();
    cleanup();
    render({ aufgabenHref: "/team/aufgaben?typ=ausstempeln" });
    const link = screen.getByText("Zu den Aufgaben") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/team/aufgaben?typ=ausstempeln");
  });

  it("says so when nothing is open, and renders no list", () => {
    render({
      data: { ...DATA, open: [], kpis: { ...DATA.kpis, openCount: 0 } },
    });
    expect(screen.getByTestId("salon-hours-no-open").textContent).toContain(
      "Nichts offen in diesem Zeitraum.",
    );
    expect(screen.queryByTestId("salon-hours-open-list")).toBeNull();
  });
});

describe("SalonHoursView - exchange card (Issue #1030)", () => {
  it("shows the heading, its hint and both directions with the server's minutes", () => {
    render();
    expect(screen.getByRole("heading", { name: "Austausch mit anderen Salons" })).toBeTruthy();
    expect(screen.getByTestId("salon-hours-exchange-hint").textContent).toBe(
      "Gezählt werden geschlossene, gültige Arbeitszeiten bis zum Stichtag. Eine Aushilfe zählt zu ihrem Stammsalon am Ende des Zeitraums.",
    );
    const from = screen.getByTestId("salon-hours-exchange-from");
    expect(from.textContent).toContain("Salon Süd");
    expect(from.textContent).toContain("2:30");
    expect(from.textContent).toContain("ohne Stammsalon");
    expect(from.textContent).toContain("1:30");
    const own = screen.getByTestId("salon-hours-exchange-own");
    expect(own.textContent).toContain("Salon Süd");
    expect(own.textContent).toContain("10:00");
  });

  it("offers the CSV download only with the export right, and calls onExport", async () => {
    const first = render();
    expect(first.queryByRole("button", { name: "Als CSV herunterladen" })).toBeNull();
    cleanup();
    const onExport = vi.fn();
    render({ canExport: true, onExport });
    await fireEvent.click(screen.getByRole("button", { name: "Als CSV herunterladen" }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("says so when no hours were exchanged in a direction", () => {
    render({
      data: { ...DATA, exchange: { fromOtherSalons: [], ownTeamElsewhere: [] } },
    });
    expect(screen.getAllByText("Keine Stunden in diesem Zeitraum.")).toHaveLength(2);
    expect(screen.queryByTestId("salon-hours-exchange-from")).toBeNull();
  });
});
