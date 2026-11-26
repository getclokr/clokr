// Issue #992 (N-02, S-14; D-992-27, D-992-28) - the absence timeline at a narrow quarter and a requested
// year cell. The shared harness of AbsenceTimeline.test.ts is mirrored in miniature.
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import AbsenceTimeline from "../timeline/AbsenceTimeline.svelte";
import { periodOf, type TimelinePerson } from "$lib/leave/timeline-model";

const person: TimelinePerson = {
  employeeId: "e1",
  name: "Anna Muster",
  isOwn: false,
  bars: [
    {
      key: "req",
      start: "2026-11-16",
      end: "2026-11-18",
      style: "beantragt",
      typeCode: "VACATION",
      label: "Urlaub",
      editable: false,
    },
  ],
};

const load = {
  kind: "day" as const,
  counts: new Map([
    ["2026-11-10", 1],
    ["2026-11-11", 2],
    ["2026-11-12", 5],
  ]),
};

function mountQuarter(columnWidthPx: number) {
  renderWithTheme(AbsenceTimeline, {
    rows: [person],
    period: periodOf("quartal", "2026-11-15"),
    holidays: [],
    today: "2026-11-10",
    columnWidthPx,
    load,
    onBarSelect: vi.fn(),
  });
}

describe("narrow quarter (S-14)", () => {
  it("the load cells carry a tint and no digit, the count stays in title and aria-label", () => {
    mountQuarter(11);
    for (const [day, level, count] of [
      ["2026-11-10", "1", 1],
      ["2026-11-11", "2", 2],
      ["2026-11-12", "3", 5],
    ] as const) {
      const cell = screen.getByTestId(`day-load-${day}`);
      expect(cell.textContent?.trim()).toBe("");
      expect(cell.getAttribute("data-level")).toBe(level);
      expect(cell.getAttribute("title")).toContain(`${count} Personen abwesend`);
      expect(cell.getAttribute("aria-label")).toContain(`${count} Personen abwesend`);
    }
  });

  it("the header names the weeks and prints no day numbers", () => {
    mountQuarter(11);
    expect(screen.getByTestId("week-label-KW-46").textContent?.trim()).toBe("KW 46");
    expect(screen.getByTestId("week-label-KW-47")).toBeTruthy();
    for (const day of ["2026-11-09", "2026-11-10", "2026-11-16"]) {
      expect(screen.getByTestId(`absence-day-${day}`).textContent?.trim()).toBe("");
    }
  });
});

describe("wide quarter (unchanged)", () => {
  it("shows digits and day numbers, no week labels", () => {
    mountQuarter(24);
    expect(screen.getByTestId("day-load-2026-11-12").textContent?.trim()).toBe("5");
    expect(screen.getByTestId("day-load-2026-11-12").getAttribute("data-level")).toBeNull();
    expect(screen.getByTestId("absence-day-2026-11-10").textContent).toContain("10");
    expect(screen.queryByTestId("week-label-KW-46")).toBeNull();
  });
});

describe("year cell of a requested absence (N-02)", () => {
  it("the dashed edge sits on the fill, the button of an empty week has no dashed border", () => {
    renderWithTheme(AbsenceTimeline, {
      rows: [person],
      period: periodOf("jahr", "2026-06-01"),
      holidays: [],
      today: "2026-11-10",
      widthPx: 1144,
      onBarSelect: vi.fn(),
      onWeekSelect: vi.fn(),
    });
    const requested = screen.getByTestId("week-cell-e1-2026-11-16");
    expect(requested.classList.contains("tl-week--beantragt")).toBe(false);
    expect(requested.querySelector(".tl-week-fill--beantragt")).not.toBeNull();
    const empty = screen.getByTestId("week-cell-e1-2026-11-02");
    expect(empty.querySelector(".tl-week-fill")).toBeNull();
    expect(empty.classList.contains("tl-week--beantragt")).toBe(false);
  });
});
