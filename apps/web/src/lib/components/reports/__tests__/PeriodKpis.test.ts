// Issue #612 (D-612-3, AC-612-3, P-05, UI-SPEC "KPI card") - the eight period figures, mounted.
// lib/components/reports/ is outside the lint:ui-classes gate (CLAUDE.md), so order, formats,
// withheld states and notes are proven here. Pattern 3: the component formats server figures and
// adds nothing - the tiles are checked against hand-computed German strings, never against a sum.

import { describe, it, expect, vi } from "vitest";

// The shared salon texts come from page-scope, which pulls in the api client and the auth store; a
// stand-in (as in SalonScopeLabel.test.ts) keeps this file free of that bootstrap.
vi.mock("$api/client", () => ({
  api: { get: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock("$lib/utils/logger", () => ({ clientLogger: { warn: vi.fn(), error: vi.fn() } }));

import { screen, within } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import {
  HOME_SALON_CHANGE_NOTE,
  PERSON_SALDO_BY_HOME_SALON_LABEL,
  SALON_WORKED_DELTA_NOTE,
  SALON_WORKED_LABEL,
  withoutHomeSalonNote,
} from "$lib/salons/page-scope";
import type { PeriodKpis as Kpis } from "$lib/reports/period-report";
import PeriodKpis from "../PeriodKpis.svelte";
import source from "../PeriodKpis.svelte?raw";

function kpis(overrides: Partial<Kpis> = {}): Kpis {
  return {
    personCount: 24,
    saldoPersonCount: 24,
    workedMinutes: 230535, // 3.842:15
    expectedMinutes: 228000, // 3.800:00
    balanceMinutes: 765, // +12:45
    closingBalanceMinutes: 72270, // +1.204:30
    closingAsOf: "2026-09-30",
    closingConfirmed: true,
    allMonthsConfirmed: true,
    sickDays: 12.5,
    vacationYear: 2026,
    vacationAsOf: "2026-10-16",
    vacationTakenDays: 240,
    vacationApprovedDays: 35.5,
    vacationEntitlementDays: 720,
    ...overrides,
  };
}

// Issue #993 N-10: each period tab shows its own strip, four tiles each.
const TIME_LABELS = ["Saldo im Zeitraum", "Gesamtsaldo am Ende", "Ist", "Soll"];
const VACATION_LABELS = [
  "Urlaub genommen",
  "Urlaub genehmigt",
  "Urlaubsanspruch",
  "Krankheitstage",
];
const LABELS = [...TIME_LABELS, ...VACATION_LABELS];

type Tab = "zeiten" | "urlaub";

/** Mounts one tab of the figures; `tab` left out is the default (the time figures). */
function mount(tab: Tab | undefined, kpiOverrides: Partial<Kpis> = {}, extra = {}) {
  return renderWithTheme(PeriodKpis, {
    kpis: kpis(kpiOverrides),
    filterActive: false,
    loading: false,
    ...(tab === undefined ? {} : { tab }),
    ...extra,
  });
}

const labelsShown = () =>
  [...document.querySelectorAll(".kpi-label")].map((e) => e.textContent?.trim());

/**
 * The tile whose label is `label`: the figure and its unit joined by one space (the unit is its
 * own flex item, the visible gap comes from CSS), and the delta line as rendered text.
 */
function tile(label: string): { value: string; delta: string | null } {
  const article = screen.getByText(label, { selector: ".kpi-label" }).closest("article")!;
  const valueEl = article.querySelector(".kpi-value")!;
  const unit = valueEl.querySelector(".kpi-unit")?.textContent?.trim() ?? "";
  const figure = [...valueEl.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent)
    .join("")
    .trim();
  const delta = article.querySelector(".kpi-delta")?.textContent?.trim() ?? null;
  return { value: unit === "" ? figure : `${figure} ${unit}`, delta };
}

describe("PeriodKpis - the eight tiles", () => {
  it("renders the eight tiles in the UI-SPEC order with the copy-deck labels, four on each tab", () => {
    const zeiten = mount("zeiten");
    const first = labelsShown();
    zeiten.unmount();
    mount("urlaub");
    expect([...first, ...labelsShown()]).toEqual(LABELS);
    expect(first).toEqual(TIME_LABELS);
  });

  it("formats hours from minutes (signed for the two saldo tiles) and days with a decimal comma", () => {
    const zeiten = mount("zeiten");
    expect(tile("Saldo im Zeitraum").value).toBe("+12:45 h");
    expect(tile("Gesamtsaldo am Ende").value).toBe("+1.204:30 h");
    expect(tile("Ist").value).toBe("3.842:15 h");
    expect(tile("Soll").value).toBe("3.800:00 h");
    zeiten.unmount();
    mount("urlaub");
    expect(tile("Urlaub genommen").value).toBe("240 Tage");
    expect(tile("Urlaub genehmigt").value).toBe("35,5 Tage");
    expect(tile("Urlaubsanspruch").value).toBe("720 Tage");
    expect(tile("Krankheitstage").value).toBe("12,5 Tage");
  });

  // Issue #993 N-05 (D-993-04): two decimals like the PDF, and a unit that agrees with the value.
  it("prints two decimals and a unit that agrees with the shown value (#993 N-05)", () => {
    mount("urlaub", { vacationEntitlementDays: 79.25, vacationTakenDays: 6.25, sickDays: 1 });
    expect(tile("Urlaubsanspruch").value).toBe("79,25 Tage");
    expect(tile("Urlaub genommen").value).toBe("6,25 Tage");
    expect(tile("Krankheitstage").value).toBe("1 Tag");
  });

  it("keeps the plural for every other count of sick days (#993 N-05)", () => {
    mount("urlaub", { sickDays: 2 });
    expect(tile("Krankheitstage").value).toBe("2 Tage");
  });

  it("a negative saldo carries U+2212 and a zero saldo the plus-minus sign", () => {
    mount("zeiten", { balanceMinutes: -45, closingBalanceMinutes: 0 });
    expect(tile("Saldo im Zeitraum").value).toBe("−0:45 h");
    expect(tile("Gesamtsaldo am Ende").value).toBe("±0:00 h");
  });

  it("deltas of a fully confirmed period: bestätigt, Stand + bestätigt, vacation per P-05, Kalendertage", () => {
    const zeiten = mount("zeiten");
    expect(tile("Saldo im Zeitraum").delta).toBe("bestätigt");
    expect(tile("Gesamtsaldo am Ende").delta).toBe("Stand 30.9.2026 · bestätigt");
    expect(tile("Ist").delta).toBeNull();
    expect(tile("Soll").delta).toBeNull();
    zeiten.unmount();
    mount("urlaub");
    expect(tile("Urlaub genommen").delta).toBe("bis 16.10.2026, Urlaubsjahr 2026");
    expect(tile("Urlaub genehmigt").delta).toBe("nach 16.10.2026, Urlaubsjahr 2026");
    expect(tile("Urlaubsanspruch").delta).toBe("Urlaubsjahr 2026");
    expect(tile("Krankheitstage").delta).toBe("Kalendertage");
  });

  it("a period with an open month says Prognose in both saldo deltas and shows the forecast note", () => {
    mount("zeiten", {
      allMonthsConfirmed: false,
      closingConfirmed: false,
      closingAsOf: "2026-10-15",
    });
    expect(tile("Saldo im Zeitraum").delta).toBe("enthält Prognose");
    expect(tile("Gesamtsaldo am Ende").delta).toBe("Stand 15.10.2026 · Prognose");
    expect(screen.getByTestId("period-kpis-forecast-note")).toHaveTextContent(
      "Offene Monate sind eine Prognose und ändern sich bis zum Monatsabschluss.",
    );
  });

  it("a fully confirmed period shows no forecast note", () => {
    mount("zeiten");
    expect(screen.queryByTestId("period-kpis-forecast-note")).toBeNull();
  });
});

describe("PeriodKpis - withheld figures", () => {
  it("no overtime:read: the two saldo tiles and Soll read a dash with no unit and the reason as delta", () => {
    const zeiten = mount("zeiten", {
      expectedMinutes: null,
      balanceMinutes: null,
      closingBalanceMinutes: null,
      saldoPersonCount: 0,
    });
    for (const label of ["Saldo im Zeitraum", "Gesamtsaldo am Ende", "Soll"]) {
      expect(tile(label), label).toEqual({ value: "—", delta: "Keine Berechtigung" });
    }
    // The strip does not jump: still four tiles, Ist keeps its value.
    expect(tile("Ist").value).toBe("3.842:15 h");
    expect(document.querySelectorAll(".kpi-label")).toHaveLength(4);
    // Nobody is covered: the partial-coverage line does not appear.
    expect(screen.getByTestId("period-kpis-persons")).toHaveTextContent(/^Summe über 24 Personen$/);
    // The vacation tab keeps its values although the saldo is withheld.
    zeiten.unmount();
    mount("urlaub", { saldoPersonCount: 0 });
    expect(tile("Urlaubsanspruch").value).toBe("720 Tage");
  });

  it("under a salon filter without overtime:read the same tiles read the dash with Keine Berechtigung, never a salon reason", () => {
    mount(
      "zeiten",
      {
        expectedMinutes: null,
        balanceMinutes: null,
        closingBalanceMinutes: null,
        saldoPersonCount: 0,
        salonWorkedMinutes: 4800,
      },
      { filterActive: true, withoutHomeSalonCount: 0 },
    );
    for (const label of ["Saldo im Zeitraum", "Gesamtsaldo am Ende", "Soll"]) {
      expect(tile(label), label).toEqual({ value: "—", delta: "Keine Berechtigung" });
    }
    expect(screen.queryByText("Nicht je Salon")).toBeNull();
  });
  it("no salon note and no salon-hours tile without a filter", () => {
    mount("zeiten");
    expect(screen.queryByTestId("period-kpis-salon-note")).toBeNull();
    expect(screen.queryByText(SALON_WORKED_LABEL, { selector: ".kpi-label" })).toBeNull();
    expect(document.querySelectorAll(".kpi-label")).toHaveLength(4);
  });
});

// Issue #714 (owner decision 19.10.2026): under a salon filter the card shows the whole sums of the
// persons by Stammsalon, with the hint; the hours worked in the salon are a separate tile with no
// saldo delta. The component formats server figures and sums nothing.
describe("PeriodKpis - under a salon filter (#714)", () => {
  const filtered = (
    overrides: Partial<Kpis> = {},
    withoutHomeSalonCount = 2,
    tab: Tab = "zeiten",
  ) =>
    mount(
      tab,
      { salonWorkedMinutes: 4800, ...overrides },
      { filterActive: true, withoutHomeSalonCount },
    );

  it("shows the server's whole-person Soll and saldo with the normal deltas", () => {
    filtered();
    expect(tile("Saldo im Zeitraum")).toEqual({ value: "+12:45 h", delta: "bestätigt" });
    expect(tile("Gesamtsaldo am Ende")).toEqual({
      value: "+1.204:30 h",
      delta: "Stand 30.9.2026 · bestätigt",
    });
    expect(tile("Soll")).toEqual({ value: "3.800:00 h", delta: null });
  });

  it("the callout names the circle, the mover rule and the persons without a Stammsalon", () => {
    filtered();
    const note = screen.getByTestId("period-kpis-salon-note");
    // Issue #1058: the callout became an info symbol (the brand-tone Note is gone); its text element
    // stays the described target of a trigger named after what it explains.
    const trigger = screen.getByRole("button", { name: "Erklärung zu „Personen nach Stammsalon“" });
    expect(trigger.getAttribute("aria-describedby")).toBe(note.id);
    expect(note).toHaveTextContent(PERSON_SALDO_BY_HOME_SALON_LABEL);
    expect(note).toHaveTextContent(HOME_SALON_CHANGE_NOTE);
    expect(note).toHaveTextContent(withoutHomeSalonNote(2));
  });

  it("leaves the remainder sentence out when nobody is without a Stammsalon", () => {
    filtered({}, 0);
    const note = screen.getByTestId("period-kpis-salon-note");
    expect(note).toHaveTextContent(PERSON_SALDO_BY_HOME_SALON_LABEL);
    expect(note).not.toHaveTextContent("ohne Stammsalon");
  });

  it("adds the salon hours as a fifth tile on the time tab, in a strip of its own, with no saldo delta", () => {
    filtered();
    expect(document.querySelectorAll(".kpi-label")).toHaveLength(5);
    expect(tile(SALON_WORKED_LABEL)).toEqual({ value: "80:00 h", delta: SALON_WORKED_DELTA_NOTE });
    const article = screen
      .getByText(SALON_WORKED_LABEL, { selector: ".kpi-label" })
      .closest("article")!;
    const strip = article.closest(".kpi-strip")!;
    expect(strip.querySelectorAll("article")).toHaveLength(1);
    expect(screen.getByTestId("period-kpis-salon-hours")).toContainElement(strip as HTMLElement);
  });

  it("shows no salon-hours tile while the answer carries no salon hours", () => {
    filtered({ salonWorkedMinutes: undefined });
    expect(document.querySelectorAll(".kpi-label")).toHaveLength(4);
  });

  it("the vacation tab has no salon-hours tile, but keeps the Stammsalon hint", () => {
    filtered({}, 2, "urlaub");
    expect(screen.queryByText(SALON_WORKED_LABEL, { selector: ".kpi-label" })).toBeNull();
    expect(screen.queryByTestId("period-kpis-salon-hours")).toBeNull();
    expect(screen.getByTestId("period-kpis-salon-note")).toHaveTextContent(
      PERSON_SALDO_BY_HOME_SALON_LABEL,
    );
  });

  it("the skeleton keeps four lines under a filter", () => {
    renderWithTheme(PeriodKpis, {
      kpis: null,
      filterActive: true,
      withoutHomeSalonCount: null,
      loading: true,
    });
    expect(screen.getByTestId("period-kpis-skeleton").querySelectorAll(".skeleton")).toHaveLength(
      4,
    );
  });
});

describe("PeriodKpis - person counts", () => {
  it("names the number of persons, singular for one", () => {
    renderWithTheme(PeriodKpis, {
      kpis: kpis({ personCount: 1, saldoPersonCount: 1 }),
      filterActive: false,
      loading: false,
    });
    expect(screen.getByTestId("period-kpis-persons")).toHaveTextContent("Summe über 1 Person");
    expect(screen.getByTestId("period-kpis-persons")).not.toHaveTextContent("Personen");
  });

  it("names the covered share when saldo is covered for fewer persons than listed", () => {
    renderWithTheme(PeriodKpis, {
      kpis: kpis({ personCount: 24, saldoPersonCount: 18 }),
      filterActive: false,
      loading: false,
    });
    const line = screen.getByTestId("period-kpis-persons");
    expect(line).toHaveTextContent("Summe über 24 Personen");
    expect(line).toHaveTextContent("Saldo: Summe über 18 von 24 Personen");
  });

  it("an empty period reads zeros, not dashes", () => {
    const empty = {
      personCount: 0,
      saldoPersonCount: 0,
      workedMinutes: 0,
      expectedMinutes: 0,
      balanceMinutes: 0,
      closingBalanceMinutes: 0,
      sickDays: 0,
      vacationTakenDays: 0,
      vacationApprovedDays: 0,
      vacationEntitlementDays: 0,
    };
    const zeiten = mount("zeiten", empty);
    expect(tile("Ist").value).toBe("0:00 h");
    zeiten.unmount();
    mount("urlaub", empty);
    expect(tile("Krankheitstage").value).toBe("0 Tage");
    expect(screen.getByTestId("period-kpis-persons")).toHaveTextContent("Summe über 0 Personen");
  });
});

describe("PeriodKpis - loading", () => {
  it("first load: four skeleton lines (one strip), aria-busy, no tiles", () => {
    renderWithTheme(PeriodKpis, { kpis: null, filterActive: false, loading: true });
    const root = screen.getByTestId("period-kpis");
    expect(root).toHaveAttribute("aria-busy", "true");
    expect(
      within(root).getByTestId("period-kpis-skeleton").querySelectorAll(".skeleton"),
    ).toHaveLength(4);
    expect(document.querySelectorAll(".kpi-label")).toHaveLength(0);
  });

  it("a later load keeps the old figures and marks the region busy", () => {
    renderWithTheme(PeriodKpis, { kpis: kpis(), filterActive: false, loading: true });
    expect(screen.getByTestId("period-kpis")).toHaveAttribute("aria-busy", "true");
    expect(document.querySelectorAll(".kpi-label")).toHaveLength(4);
    expect(screen.queryByTestId("period-kpis-skeleton")).toBeNull();
  });

  it("settled: not busy", () => {
    renderWithTheme(PeriodKpis, { kpis: kpis(), filterActive: false, loading: false });
    expect(screen.getByTestId("period-kpis")).toHaveAttribute("aria-busy", "false");
  });
});

describe("PeriodKpis - source", () => {
  it("is non-empty, imports no $app module and does not colour the figures by sign", () => {
    expect(source.length).toBeGreaterThan(1000);
    expect(source).not.toContain("$app/");
    expect(source).not.toMatch(/deltaTone/);
  });

  it("is built from KpiStrips of the Kennzahlenleiste block, not from page-own tiles", () => {
    expect(source).toContain(
      'import KpiStrip, { type KpiItem } from "$components/ui/KpiStrip.svelte"',
    );
    expect(source).not.toContain("KPIStat");
    expect(source).not.toMatch(/class="[^"]*\bkpi/);
  });

  it("renders the groups as strips: time and, under a filter, the salon hours on one tab, vacation on the other", () => {
    const zeiten = mount(
      "zeiten",
      { salonWorkedMinutes: 4800 },
      { filterActive: true, withoutHomeSalonCount: 0 },
    );
    expect(document.querySelectorAll(".kpi-strip")).toHaveLength(2);
    zeiten.unmount();
    mount("urlaub", { salonWorkedMinutes: 4800 }, { filterActive: true, withoutHomeSalonCount: 0 });
    expect(document.querySelectorAll(".kpi-strip")).toHaveLength(1);
  });
});

// Issue #985 (D-01): the running month counts Soll, Ist and saldo through yesterday; the strip names
// that Stichtag, and only for a running-month answer.
describe("PeriodKpis - running month note (#985)", () => {
  const NOTE =
    "Laufender Monat bis gestern (14.11.): Soll, Ist, Saldo und Abwesenheiten zählen bis zu diesem Tag.";

  it("names the Stichtag when the answer ends in the running month", () => {
    renderWithTheme(PeriodKpis, {
      kpis: kpis({ closingAsOf: "2026-11-14", closingConfirmed: false }),
      filterActive: false,
      loading: false,
      periodTo: "2026-11",
    });
    expect(screen.getByTestId("period-kpis-running-month").textContent?.trim()).toBe(NOTE);
  });

  it("renders nothing for a past period", () => {
    renderWithTheme(PeriodKpis, {
      kpis: kpis({ closingAsOf: "2026-09-30" }),
      filterActive: false,
      loading: false,
      periodTo: "2026-09",
    });
    // control: the strip itself rendered, only the note is absent
    expect(screen.getByTestId("period-kpis-persons")).toBeTruthy();
    expect(screen.queryByTestId("period-kpis-running-month")).toBeNull();
  });

  it("renders nothing without periodTo", () => {
    renderWithTheme(PeriodKpis, {
      kpis: kpis({ closingAsOf: "2026-11-14" }),
      filterActive: false,
      loading: false,
    });
    expect(screen.getByTestId("period-kpis-persons")).toBeTruthy();
    expect(screen.queryByTestId("period-kpis-running-month")).toBeNull();
  });
});

// Issue #993 N-10 (D-993-03): Saldo figures above a vacation table were the finding. Each period tab
// shows its own strip; the running-month note and the persons hint belong to both.
describe("PeriodKpis - each tab with its own figures (#993 N-10)", () => {
  const strip = (name: string) => document.querySelector(`[aria-label="${name}"]`);

  it("zeiten: the time strip, not the vacation strip", () => {
    mount("zeiten");
    expect(strip("Zeiten und Konten im Zeitraum")).not.toBeNull();
    expect(strip("Urlaub und Krankheit im Zeitraum")).toBeNull();
  });

  it("urlaub: the vacation strip, not the time strip", () => {
    mount("urlaub");
    expect(strip("Urlaub und Krankheit im Zeitraum")).not.toBeNull();
    expect(strip("Zeiten und Konten im Zeitraum")).toBeNull();
  });

  it("without a tab the component behaves as zeiten", () => {
    mount(undefined);
    expect(strip("Zeiten und Konten im Zeitraum")).not.toBeNull();
    expect(strip("Urlaub und Krankheit im Zeitraum")).toBeNull();
  });

  it("the running-month note and the persons hint show on both tabs", () => {
    for (const tab of ["zeiten", "urlaub"] as const) {
      const view = mount(tab, { closingAsOf: "2026-11-14" }, { periodTo: "2026-11" });
      expect(screen.getByTestId("period-kpis-running-month")).toBeInTheDocument();
      expect(screen.getByTestId("period-kpis-persons")).toHaveTextContent("Summe über 24 Personen");
      view.unmount();
    }
  });

  it("the forecast note belongs to the time tab only", () => {
    const open = { allMonthsConfirmed: false, closingConfirmed: false };
    const zeiten = mount("zeiten", open);
    expect(screen.getByTestId("period-kpis-forecast-note")).toBeInTheDocument();
    zeiten.unmount();
    mount("urlaub", open);
    expect(screen.queryByTestId("period-kpis-forecast-note")).toBeNull();
  });

  it("the saldo coverage line is a saldo statement and stays on the time tab", () => {
    const partial = { personCount: 24, saldoPersonCount: 18 };
    const zeiten = mount("zeiten", partial);
    expect(screen.getByTestId("period-kpis-persons")).toHaveTextContent(
      "Saldo: Summe über 18 von 24 Personen",
    );
    zeiten.unmount();
    mount("urlaub", partial);
    expect(screen.getByTestId("period-kpis-persons")).not.toHaveTextContent("Saldo:");
  });
});
