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
import viewSource from "../SalonHoursView.svelte?raw";

/** The body rows of one group of the ONE raster (the group header rows are not rows of a person). */
function groupRows(group: "stammteam" | "aushilfen"): HTMLTableRowElement[] {
  return [
    ...screen
      .getByTestId("salon-hours-raster")
      .querySelectorAll<HTMLTableRowElement>(`tbody tr[data-group="${group}"]`),
  ];
}

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
    expect(screen.queryByTestId("salon-hours-raster")).toBeNull();
  });

  it("answers a rejected salon with a calm text", () => {
    render({ status: "rejected", data: null });
    expect(screen.getByText(/Für diesen Salon liegt keine Salonansicht vor/)).toBeTruthy();
    expect(screen.queryByTestId("salon-hours-raster")).toBeNull();
  });

  it("shows no table while loading and keeps the period control", () => {
    render({ status: "loading", data: null, salonName: "Salon Nord" });
    expect(screen.queryByTestId("salon-hours-raster")).toBeNull();
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

  it("renders ONE table: Stammteam and Aushilfen are row groups with a header row each", () => {
    render();
    const raster = screen.getByTestId("salon-hours-raster");
    expect(raster.querySelectorAll("table")).toHaveLength(1);
    const groups = [...raster.querySelectorAll("tbody tr.dt-group")].map((tr) =>
      tr.textContent?.replace(/\s+/g, " ").trim(),
    );
    expect(groups).toEqual(["Stammteam (2)", "Aushilfen aus anderen Salons (2)"]);
    // Both groups sit in the same body, so their day columns line up.
    expect(raster.querySelectorAll("tbody")).toHaveLength(1);
    expect(groupRows("stammteam")).toHaveLength(2);
    expect(groupRows("aushilfen")).toHaveLength(2);
    // One head row, one footer row.
    expect(raster.querySelectorAll("thead tr")).toHaveLength(1);
    expect(raster.querySelectorAll("tfoot tr")).toHaveLength(1);
  });

  it("renders one Stammteam row per server row with the cell hours and no Personalnummer", () => {
    const { container } = render();
    const rows = groupRows("stammteam");
    expect(rows[0].textContent).toContain("Anna Berg");
    expect(rows[0].textContent).toContain("8:00");
    expect(rows[1].textContent).toContain("Bernd Adler");
    // A bare number under the name tells a reader nothing: the raster never prints it.
    expect(screen.getByTestId("salon-hours-raster").textContent).not.toContain("1001");
    // The head never wraps: the day label keeps its no-break space.
    expect(container.querySelector("th[title='Montag, 23.11.2026']")?.textContent).toBe(
      "Mo\u00a023.",
    );
  });

  it("keeps the day columns equal: fixed layout, a sticky person column, a right-aligned edge", () => {
    const { container } = render();
    const table = container.querySelector("table")!;
    expect(table.classList.contains("dt-fixed")).toBe(true);
    expect(table.classList.contains("dt-sticky-first")).toBe(true);
    // 13 rem person + 5 rem sum + 7 day columns of 4.5 rem at least.
    expect(table.getAttribute("style")).toContain("min-width: 49.5rem");
    const heads = [...table.querySelectorAll("thead th")];
    expect(heads).toHaveLength(9);
    // Head and values share the right edge: every day head and the sum head are end-aligned.
    expect(heads.slice(1).every((th) => th.classList.contains("dt-end"))).toBe(true);
    const cellsOfAnna = [...groupRows("stammteam")[0].querySelectorAll("td")];
    expect(cellsOfAnna.slice(1).every((td) => td.classList.contains("dt-end"))).toBe(true);
  });

  it("shows the server's totals, the combined day sums in ONE „Summe im Salon“ row", () => {
    render();
    const raster = screen.getByTestId("salon-hours-raster");
    // totalMinutes 555 = 9:15, while the cells add up to 8:00.
    expect(groupRows("stammteam")[0].textContent).toContain("9:15");
    const foot = raster.querySelector("tfoot tr")!;
    expect(foot.textContent).toContain("Summe im Salon");
    // 777 + 321 = 1098 = 18:18 (the two server totals of the groups); the sum is the server's KPI
    // 1234 = 20:34, never a re-sum of the cells (they add up to 8:00).
    expect(foot.textContent).toContain("18:18");
    expect(foot.textContent).toContain("20:34");
    expect(foot.textContent).not.toContain("8:00");
    // A day without a total reads as the muted dash, as in the draft.
    expect(foot.querySelectorAll(".salon-hours-nil").length).toBe(6);
  });

  it("shows exactly ONE thing per cell: hours, or one chip, or the muted dash", () => {
    render();
    const anna = [...groupRows("stammteam")[0].querySelectorAll("td")];
    // person, 7 days, sum
    expect(anna).toHaveLength(9);
    // 23.11.: hours only.
    expect(anna[1].textContent?.trim()).toBe("8:00");
    // 24.11.: the one chip „in Salon Süd“ - never a dash next to it.
    expect(anna[2].textContent?.trim()).toBe("in Salon Süd");
    expect(anna[2].textContent).not.toContain("–");
    // 25.11. (not counted): „abwesend“, no dash.
    expect(anna[3].textContent?.trim()).toBe("abwesend");
    // Days without anything - counted or not counted yet - are one muted dash.
    for (const index of [4, 5, 6, 7]) {
      expect(anna[index].textContent?.trim()).toBe("–");
      expect(anna[index].querySelector(".salon-hours-nil")).not.toBeNull();
    }
    const bernd = [...groupRows("stammteam")[1].querySelectorAll("td")];
    expect(bernd[2].textContent?.trim()).toBe("anderer Salon");
    expect(bernd[1].textContent?.trim()).toBe("–");
    expect(bernd[1].querySelector(".salon-hours-nil")).not.toBeNull();
  });

  it("shows hours with their state chip beneath and no dash when a day has both", () => {
    const both = {
      ...DATA,
      stammteam: {
        ...DATA.stammteam,
        rows: DATA.stammteam.rows.map((row) =>
          row.employeeId === "e1"
            ? {
                ...row,
                cells: row.cells.map((c) =>
                  c.date === "2026-11-23"
                    ? { ...c, elsewhere: [{ salonId: "s2", salonName: "Salon Süd" }] }
                    : c,
                ),
              }
            : row,
        ),
      },
    };
    render({ data: both });
    const first = groupRows("stammteam")[0].querySelectorAll("td")[1];
    expect(first.querySelector(".salon-hours-hours")?.textContent).toBe("8:00");
    expect(first.textContent).toContain("in Salon Süd");
    expect(first.textContent).not.toContain("–");
  });

  it("names the Stichtag in the sum head and mentions no Soll or saldo anywhere", () => {
    const { container } = render();
    expect(container.querySelector("th[title='Summe bis Di, 24.11.2026']")?.textContent).toBe(
      "Summe",
    );
    expect(screen.getByTestId("salon-hours-kpi-total").textContent).toContain("bis Di, 24.11.2026");
    const visible = (document.body.textContent ?? "").replace(
      "Soll, Saldo und Überstunden gehören zur Person, nicht zum Salon. Du findest sie in der Personenansicht.",
      "",
    );
    expect(visible).not.toMatch(/Soll|Saldo|Überstunden/);
  });

  it("puts the open list and the exchange card in an aside beside the raster from 1100 px", () => {
    const { container } = render();
    const aside = container.querySelector("aside.salon-hours-aside")!;
    expect(aside.textContent).toContain("Offen in diesem Salon");
    expect(aside.textContent).toContain("Austausch mit anderen Salons");
    expect(aside.querySelector("table")).toBeNull();
    expect(screen.getByTestId("salon-hours-raster").closest("aside")).toBeNull();
    // The two-column layout is the wide container breakpoint of the blocks, never a viewport query.
    expect(viewSource).toMatch(/@container \(min-width: 1100px\)[\s\S]*320px/);
    expect(viewSource).not.toMatch(/@media/);
  });

  it("lists only days with hours or a state on the card layout and notes an empty person", () => {
    render();
    // Dora Frei has no day with hours or a state: one muted line (printed on the card layout only).
    const notes = [...document.querySelectorAll(".salon-hours-none-note")];
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toBe("keine Stunden in diesem Zeitraum");
    expect(groupRows("aushilfen")[1].contains(notes[0])).toBe(true);
    // Carla (hours) and Bernd (a state chip) have a day to list: no note.
    expect(groupRows("aushilfen")[0].querySelector(".salon-hours-none-note")).toBeNull();
    expect(groupRows("stammteam")[1].querySelector(".salon-hours-none-note")).toBeNull();
    // The card layout leaves out the dash cells and shows the note.
    expect(viewSource).toMatch(
      /@container \(max-width: 759\.98px\)[\s\S]*\.salon-hours-none-note \{\s*display: block;/,
    );
    expect(viewSource).toMatch(/td:has\(> \.salon-hours-nil\)/);
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
  it("lists the helpers as a group of the same table, the Stammsalon as a second line", () => {
    render();
    expect(
      screen.getByText("Aushilfen aus anderen Salons (2)", { selector: ".dt-group-label" }),
    ).toBeTruthy();
    const rows = groupRows("aushilfen");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Carla Gast");
    expect(rows[0].querySelector(".salon-hours-sub-line")?.textContent).toBe(
      "Stammsalon Salon Süd",
    );
    expect(rows[1].querySelector(".salon-hours-sub-line")?.textContent).toBe("ohne Stammsalon");
    // No Stammsalon COLUMN: the heads are Person, the days, Summe.
    const heads = [...screen.getByTestId("salon-hours-raster").querySelectorAll("thead th")].map(
      (th) => th.textContent,
    );
    expect(heads).toHaveLength(9);
    expect(heads[0]).toBe("Person");
    expect(heads).not.toContain("Stammsalon");
    // No helper appears among the Stammteam rows.
    expect(
      groupRows("stammteam")
        .map((r) => r.textContent)
        .join(),
    ).not.toContain("Carla Gast");
  });

  it("says so when no helper worked in the salon, and renders no helper table", () => {
    render({
      data: { ...DATA, aushilfen: { rows: [], dayTotals: [0, 0, 0, 0, 0, 0, 0], totalMinutes: 0 } },
    });
    expect(screen.getByTestId("salon-hours-no-helpers").textContent).toContain(
      "Keine Aushilfen aus anderen Salons in diesem Zeitraum.",
    );
    expect(groupRows("aushilfen")).toHaveLength(0);
    expect(
      screen.getByTestId("salon-hours-raster").querySelector("tr.dt-group")?.textContent,
    ).toContain("Stammteam (2)");
    expect(screen.getByTestId("salon-hours-raster").querySelectorAll("tr.dt-group")).toHaveLength(
      1,
    );
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
    const [anna, bernd] = groupRows("stammteam");
    expect(anna.textContent).toContain("in Salon Süd");
    expect(anna.textContent).toContain("abwesend");
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
    const buttons = groupRows("stammteam")[0].querySelectorAll("button");
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
    expect(groupRows("stammteam")[1].querySelectorAll("button")).toHaveLength(0);
    expect(groupRows("aushilfen").flatMap((r) => [...r.querySelectorAll("button")])).toHaveLength(
      0,
    );
  });

  it("makes no cell a button without clickable ids", () => {
    render();
    expect(screen.getByTestId("salon-hours-raster").querySelectorAll("tbody button")).toHaveLength(
      0,
    );
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
    const anna = groupRows("stammteam")[0];
    // The open day has hours here, so the chip sits beneath them.
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
    const button = screen.getByRole("button", { name: "Als CSV herunterladen" });
    // The CSV button sits inside the exchange card of the aside.
    expect(button.closest("aside")).not.toBeNull();
    await fireEvent.click(button);
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
