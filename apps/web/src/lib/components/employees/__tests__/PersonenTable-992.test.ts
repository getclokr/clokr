// Issue #992 (N-14, N-21, S-22; D-992-05..07) - the shared person table says where a row leads, prints the
// number as „Nr. 5“ and, on request, drops two columns from the phone cards.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import { personenRows, personNumberLabel, type PersonenEmployee } from "$lib/team/personen-model";
import PersonenTable from "../PersonenTable.svelte";

afterEach(() => cleanup());

const PEOPLE: PersonenEmployee[] = [
  {
    id: "p1",
    employeeNumber: "5",
    firstName: "Mia",
    lastName: "Friseurin",
    exitDate: null,
    user: { isActive: true },
    invitationStatus: "ACCEPTED",
    workSchedule: { type: "FIXED_SCHEDULE", weeklyHours: "32.00" },
    homeSalonId: null,
    roleNames: ["Mitarbeiter"],
  },
  {
    id: "p2",
    employeeNumber: "  ",
    firstName: "Ben",
    lastName: "Ohnenummer",
    exitDate: null,
    user: { isActive: true },
    invitationStatus: "ACCEPTED",
    workSchedule: { type: "FIXED_SCHEDULE", weeklyHours: "40" },
    homeSalonId: null,
    roleNames: [],
  },
];

function mount(extra: Record<string, unknown> = {}) {
  return renderWithTheme(PersonenTable, {
    listId: "team.personen.liste",
    rows: personenRows(PEOPLE, "2026-11-26"),
    total: 2,
    loading: false,
    query: "",
    onQueryInput: vi.fn(),
    filter: { status: "aktiv", vertrag: "", salon: "" },
    salonOptions: null,
    onFilterChange: vi.fn(),
    onReset: vi.fn(),
    filtered: false,
    sort: { key: "name", dir: "asc" },
    onSort: vi.fn(),
    rowTestIdPrefix: "test-person",
    openHref: (row: { id: string }) => `/team/zeiten?employeeId=${row.id}`,
    openLabel: (row: { name: string }) => `Zeiten von ${row.name} öffnen`,
    ...extra,
  });
}

describe("personNumberLabel (#992 S-22)", () => {
  it("prefixes a number with „Nr.“ and prints nothing for an empty one", () => {
    expect(personNumberLabel("5")).toBe("Nr. 5");
    expect(personNumberLabel("A-12")).toBe("Nr. A-12");
    expect(personNumberLabel(" 7 ")).toBe("Nr. 7");
    expect(personNumberLabel("")).toBe("");
    expect(personNumberLabel("   ")).toBe("");
  });

  it("leaves the model's raw number untouched (CSV and bulk code read it)", () => {
    expect(personenRows(PEOPLE, "2026-11-26")[0].number).toBe("5");
  });
});

describe("PersonenTable (#992)", () => {
  it("shows „Nr. 5“ under the name and nothing for a person without a number", () => {
    mount();
    expect(screen.getByText("Nr. 5")).toBeTruthy();
    expect(document.querySelectorAll(".p-number")).toHaveLength(1);
  });

  it("reads „Öffnen“ by default and the given text with openText, keeping the aria-label", () => {
    const first = mount();
    expect(
      screen.getAllByRole("link", { name: "Zeiten von Mia Friseurin öffnen" })[0].textContent,
    ).toBe("Öffnen");
    first.unmount();
    mount({ openText: "Zeiten" });
    const link = screen.getAllByRole("link", { name: "Zeiten von Mia Friseurin öffnen" })[0];
    expect(link.textContent?.trim()).toBe("Zeiten");
  });

  it("hides Std./Woche and Rollen on the cards only with compactCards", () => {
    const wide = mount();
    expect(document.querySelectorAll("td[data-card-hidden]")).toHaveLength(0);
    wide.unmount();
    mount({ compactCards: true });
    const hidden = [...document.querySelectorAll("tbody td[data-card-hidden]")].map((td) =>
      td.getAttribute("data-label"),
    );
    expect(new Set(hidden)).toEqual(new Set(["Std./Woche", "Rollen"]));
    // The wide table keeps its columns.
    expect([...document.querySelectorAll("thead th")].map((th) => th.textContent?.trim())).toEqual(
      expect.arrayContaining(["Std./Woche", "Rollen"]),
    );
  });
});
