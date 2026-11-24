// Issue #1029 - one slim line above the Team › Zeiten calendar instead of one callout per day.
// Unit part: the grouping by the server's flags, the #987 cap, redaction neutrality. Parity part:
// the line and the DayBreakPanel decide "has something to show" by the SAME rule. Component part:
// the line's wording and its day buttons. Source part: where the page mounts what (explicit paths).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/svelte";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { renderWithTheme } from "$tests/test-utils";
import DayBreakPanel from "$lib/components/breaks/DayBreakPanel.svelte";
import DayCheckLine from "$lib/components/breaks/DayCheckLine.svelte";
import { dayBreakPanelVisible, dayCheckLine, lineDayLabel } from "../day-check-line";
import type { DayCheck, FullDayCheck, WithheldDayCheck } from "../day-break-violation";

afterEach(() => cleanup());

function full(date: string, over: Partial<FullDayCheck> = {}): FullDayCheck {
  return {
    date,
    detail: "full",
    crossSalon: false,
    netWorkedMinutes: 480,
    totalBreakMinutes: 10,
    requiredBreakMinutes: 30,
    breakShortfall: true,
    maxDailyExceeded: false,
    breakFinding: true,
    positionUnknown: false,
    warnings: [],
    acknowledged: false,
    locked: false,
    mayAcknowledge: true,
    mayRecordDayBreak: true,
    acknowledgement: null,
    entries: [],
    gaps: [],
    dayBreaks: [],
    ...over,
  };
}

const HINT = "Für diesen Tag liegt ein Prüfhinweis vor; die Klärung erfolgt über den Stammsalon.";
function redacted(date: string, over: Partial<WithheldDayCheck> = {}): WithheldDayCheck {
  return {
    date,
    detail: "redacted",
    crossSalon: true,
    netWorkedMinutes: null,
    totalBreakMinutes: null,
    requiredBreakMinutes: null,
    breakShortfall: null,
    maxDailyExceeded: null,
    breakFinding: null,
    positionUnknown: null,
    warnings: [{ code: "FINDING_WITHHELD", severity: "warning", message: HINT, hint: true }],
    acknowledged: null,
    locked: false,
    mayAcknowledge: false,
    mayRecordDayBreak: false,
    acknowledgement: null,
    entries: null,
    gaps: null,
    dayBreaks: null,
    ...over,
  };
}

describe("dayCheckLine grouping", () => {
  it("names two open break findings as Pausenbefund days", () => {
    const line = dayCheckLine([full("2026-11-04"), full("2026-11-11")]);
    expect(line?.findings).toEqual({ days: ["2026-11-04", "2026-11-11"], more: 0, total: 2 });
    expect(line?.others.total).toBe(0);
  });

  it("an acknowledged finding, a recorded day break and a cross-salon § 3 day are Hinweis days", () => {
    const line = dayCheckLine([
      full("2026-11-02", { acknowledged: true }),
      full("2026-11-03", {
        breakFinding: false,
        dayBreaks: [{ id: "b", startTime: "2026-11-03T12:00:00", endTime: "2026-11-03T12:30:00" }],
      }),
      full("2026-11-05", { breakFinding: false, crossSalon: true, maxDailyExceeded: true }),
    ]);
    expect(line?.findings.total).toBe(0);
    expect(line?.others.days).toEqual(["2026-11-02", "2026-11-03", "2026-11-05"]);
  });

  it("a redacted day is never a Pausenbefund, whatever its warnings say", () => {
    const line = dayCheckLine([
      redacted("2026-11-06"),
      redacted("2026-11-09", {
        warnings: [{ code: "BREAK_TOO_SHORT", severity: "error", message: "x" }],
      }),
    ]);
    expect(line?.findings.total).toBe(0);
    expect(line?.others.days).toEqual(["2026-11-06", "2026-11-09"]);
  });

  it("an open finding day whose panel is not visible is still a Pausenbefund day", () => {
    const hidden = full("2026-11-10", { mayAcknowledge: false, mayRecordDayBreak: false });
    expect(dayBreakPanelVisible(hidden)).toBe(false);
    expect(dayCheckLine([hidden])?.findings.days).toEqual(["2026-11-10"]);
  });

  it("a non-finding day whose panel is not visible is in neither group", () => {
    expect(dayCheckLine([full("2026-11-10", { breakFinding: false })])).toBeNull();
  });

  it("caps each group at the five newest days and counts the rest (#987 cap)", () => {
    const days = ["02", "03", "04", "05", "06", "09", "10"].map((d) => full(`2026-11-${d}`));
    const line = dayCheckLine(days);
    expect(line?.findings).toEqual({
      days: ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10"],
      more: 2,
      total: 7,
    });
  });

  it("is null for no checks", () => {
    expect(dayCheckLine([])).toBeNull();
  });

  it("labels a day as weekday and date", () => {
    expect(lineDayLabel("2026-11-04")).toBe("Mi 04.11.");
  });
});

describe("the line and the panel share one visibility rule", () => {
  it("dayBreakPanelVisible equals what the mounted DayBreakPanel renders", () => {
    const dayBreak = { id: "b", startTime: "2026-11-04T12:00:00", endTime: "2026-11-04T12:30:00" };
    const cases: DayCheck[] = [];
    for (const crossSalon of [false, true])
      for (const breakFinding of [false, true])
        for (const maxDailyExceeded of [false, true])
          for (const dayBreaks of [[], [dayBreak]])
            for (const mayAcknowledge of [false, true])
              for (const mayRecordDayBreak of [false, true])
                for (const acknowledged of [false, true])
                  cases.push(
                    full("2026-11-04", {
                      crossSalon,
                      breakFinding,
                      maxDailyExceeded,
                      dayBreaks,
                      mayAcknowledge,
                      mayRecordDayBreak,
                      acknowledged,
                    }),
                  );
    cases.push(redacted("2026-11-04"), redacted("2026-11-04", { crossSalon: false }));
    expect(cases.length).toBe(130);
    for (const check of cases) {
      renderWithTheme(DayBreakPanel, { check });
      const rendered = screen.queryByTestId("day-break-panel") !== null;
      expect(rendered, JSON.stringify(check)).toBe(dayBreakPanelVisible(check));
      cleanup();
    }
  });
});

describe("DayCheckLine", () => {
  it("names the Pausenbefund days and opens a day on click", async () => {
    const onOpenDay = vi.fn();
    renderWithTheme(DayCheckLine, {
      checks: [full("2026-11-04"), full("2026-11-11")],
      onOpenDay,
    });
    const line = screen.getByTestId("day-check-line");
    expect(line.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "2 Tage mit Pausenbefund: Mi 04.11. · Mi 11.11.",
    );
    await fireEvent.click(screen.getByRole("button", { name: "Mi 04.11." }));
    expect(onOpenDay).toHaveBeenCalledWith("2026-11-04");
  });

  it("a redacted day reads neutral: Hinweis, no Pausenbefund, no paragraph, no figure", () => {
    renderWithTheme(DayCheckLine, { checks: [redacted("2026-11-06")], onOpenDay: () => {} });
    const text = screen.getByTestId("day-check-line").textContent ?? "";
    expect(text.replace(/\s+/g, " ").trim()).toBe("1 Tag mit Hinweis: Fr 06.11.");
    expect(text).not.toContain("Pausenbefund");
    expect(text).not.toContain("§");
    expect(text).not.toMatch(/\d+:\d{2}/);
  });

  it("joins the two groups and offers „N weitere“ for the rest", async () => {
    const onMore = vi.fn();
    const days = ["02", "03", "04", "05", "06", "09"].map((d) => full(`2026-11-${d}`));
    renderWithTheme(DayCheckLine, {
      checks: [...days, redacted("2026-11-10")],
      onOpenDay: () => {},
      onMore,
    });
    const text = screen.getByTestId("day-check-line").textContent?.replace(/\s+/g, " ") ?? "";
    expect(text).toContain("6 Tage mit Pausenbefund:");
    expect(text).toContain("1 Tag mit Hinweis: Di 10.11.");
    expect(screen.getAllByTestId("day-check-line-day")).toHaveLength(6);
    await fireEvent.click(screen.getByTestId("day-check-line-more"));
    expect(onMore).toHaveBeenCalledTimes(1);
  });

  it("renders nothing without a day to name", () => {
    renderWithTheme(DayCheckLine, { checks: [], onOpenDay: () => {} });
    expect(screen.queryByTestId("day-check-line")).toBeNull();
  });
});

const WEB_SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const TEAM = readFileSync(
  path.join(WEB_SRC, "routes/(app)/team/time-entries/+page.svelte"),
  "utf-8",
);

describe("Team › Zeiten mounts the line above the calendar and the panel in the day view", () => {
  it("the DayBreakPanel appears once, inside the day-sheet snippet", () => {
    expect(TEAM.match(/<DayBreakPanel/g)).toHaveLength(1);
    const snippetAt = TEAM.indexOf("{#snippet daySheetDayCheck");
    expect(snippetAt).toBeGreaterThan(-1);
    expect(TEAM.indexOf("<DayBreakPanel")).toBeGreaterThan(snippetAt);
    expect(TEAM).not.toContain("{#each dayChecks as dayCheck");
  });

  it("the line sits before the calendar and opens the day view", () => {
    const line = TEAM.indexOf("<DayCheckLine");
    expect(line).toBeGreaterThan(-1);
    expect(line).toBeLessThan(TEAM.indexOf('{#if teView === "calendar"}'));
    expect(TEAM).toContain("onOpenDay={openDaySheet}");
  });
});
