// Issue #597 (Phase 851) - the next days as one stream of shifts, leave and holidays.
// Issue #589 (D-589-09, D-589-10; AC-589-5, AC-589-6) - the shift's salon is named from the salon
// context, "anderer Salon" only for a salon outside it; "Frei" only on days without contract work.
import { describe, expect, it } from "vitest";
import { buildAgenda, isoWeek, type AgendaShift } from "../agenda";

const names = new Map<string, string>([
  ["nord", "Clokr Demo Nord"],
  ["haupt", "Clokr Demo"],
]);

const fixedMoFr = {
  type: "FIXED_SCHEDULE" as const,
  validFrom: "2024-01-01T00:00:00.000Z",
  mondayHours: 8,
  tuesdayHours: 8,
  wednesdayHours: 8,
  thursdayHours: 8,
  fridayHours: 8,
  saturdayHours: 0,
  sundayHours: 0,
  workDays: [1, 2, 3, 4, 5],
};
const flexMoTuWe = {
  ...fixedMoFr,
  type: "FLEXTIME" as const,
  workDays: [1, 2, 3],
  mondayHours: 1,
  tuesdayHours: 1,
  wednesdayHours: 1,
  thursdayHours: 0,
  fridayHours: 0,
};
const shiftBased = {
  ...fixedMoFr,
  type: "SHIFT_BASED" as const,
};
const monthly = {
  ...fixedMoFr,
  type: "MONTHLY_HOURS" as const,
};

type Contract = typeof fixedMoFr | typeof flexMoTuWe | typeof shiftBased | typeof monthly;

function input(
  over: {
    shifts?: AgendaShift[];
    leave?: { startDate: string; endDate: string; status: string; label: string }[];
    holidays?: { date: string; name: string }[];
    salonNames?: ReadonlyMap<string, string>;
    contract?: Contract | null;
  } = {},
) {
  return {
    shifts: over.shifts ?? [],
    leave: over.leave ?? [],
    holidays: over.holidays ?? [],
    salonNames: over.salonNames ?? names,
    contract: over.contract === undefined ? null : over.contract,
  };
}

const shift = (date: string, salonId?: string): AgendaShift => ({
  date,
  startTime: "10:00",
  endTime: "18:30",
  durationMinNetto: 480,
  salonId,
});

describe("buildAgenda", () => {
  const start = new Date(2026, 10, 9); // Mo 9.11.2026

  it("groups by week and marks today", () => {
    const weeks = buildAgenda(start, 14, input());
    expect(weeks.map((w) => w.label)).toEqual(["Diese Woche · KW 46", "Nächste Woche · KW 47"]);
    expect(weeks[0].days[0]).toMatchObject({
      weekday: "Mo",
      dayLabel: "9.11.",
      isToday: true,
    });
    expect(weeks.flatMap((w) => w.days)).toHaveLength(14);
  });

  it("names shift times and its salon", () => {
    const weeks = buildAgenda(
      start,
      7,
      input({ shifts: [shift("2026-11-10", "nord"), shift("2026-11-12", "haupt")] }),
    );
    const [tue, , thu] = weeks[0].days.slice(1);
    expect(tue).toMatchObject({
      kind: "shift",
      title: "10:00 – 18:30",
      subtitle: "Clokr Demo Nord",
      netMinutes: 480,
      otherSalon: false,
    });
    // Issue #589 (AC-589-5, 15.11.2026): a salon the caller can read is named by its name and carries
    // no "anderer Salon" mark, also when it is not the Stammsalon (before: any salon but the Stammsalon
    // was flagged).
    expect(thu).toMatchObject({ subtitle: "Clokr Demo", otherSalon: false });
  });

  it("flags 'anderer Salon' only for a salon outside the salon context", () => {
    const weeks = buildAgenda(start, 7, input({ shifts: [shift("2026-11-11", "fremd")] }));
    expect(weeks[0].days[2]).toMatchObject({ subtitle: "anderer Salon", otherSalon: true });
  });

  it("an empty salon context (fail-closed store) marks every shift salon as 'anderer Salon'", () => {
    const weeks = buildAgenda(
      start,
      7,
      input({ shifts: [shift("2026-11-10", "nord")], salonNames: new Map() }),
    );
    expect(weeks[0].days[1]).toMatchObject({ subtitle: "anderer Salon", otherSalon: true });
  });

  it("shows effective leave and holidays, ignores pending leave", () => {
    const weeks = buildAgenda(
      start,
      7,
      input({
        leave: [
          { startDate: "2026-11-11", endDate: "2026-11-11", status: "APPROVED", label: "Urlaub" },
          { startDate: "2026-11-13", endDate: "2026-11-13", status: "PENDING", label: "Urlaub" },
        ],
        holidays: [{ date: "2026-11-12", name: "Testfeiertag" }],
      }),
    );
    const d = weeks[0].days;
    expect(d[2]).toMatchObject({ kind: "leave", title: "Urlaub" });
    expect(d[3]).toMatchObject({ kind: "holiday", title: "Testfeiertag" });
    // Issue #589 (AC-589-6): with no contract known and no shift in the week, the pending-leave day is
    // not "Frei" but "Noch nicht geplant" (it was kind "free" before).
    expect(d[4]).toMatchObject({ kind: "unplanned" });
  });

  it("isoWeek counts like ISO 8601", () => {
    expect(isoWeek(new Date(2026, 10, 9))).toBe(46);
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53);
  });
});

describe("buildAgenda — Frei versus Noch nicht geplant (Issue #589, D-589-10, AC-589-6)", () => {
  const start = new Date(2026, 10, 9); // Mo 9.11.2026

  it("a FIXED_SCHEDULE contract day without shift, leave or holiday is 'Noch nicht geplant'", () => {
    const weeks = buildAgenda(start, 7, input({ contract: fixedMoFr }));
    const d = weeks[0].days;
    for (const i of [0, 1, 2, 3, 4]) {
      expect(d[i], d[i].date).toMatchObject({
        kind: "unplanned",
        title: "Noch nicht geplant",
        subtitle: "Arbeitstag laut Vertrag",
      });
    }
    expect(d[5]).toMatchObject({ kind: "free", title: "Frei" });
    expect(d[6]).toMatchObject({ kind: "free", title: "Frei" });
  });

  it("FLEXTIME follows its own workdays", () => {
    const d = buildAgenda(start, 7, input({ contract: flexMoTuWe }))[0].days;
    expect(d[0]).toMatchObject({ kind: "unplanned" });
    expect(d[3]).toMatchObject({ kind: "free", title: "Frei" });
  });

  it("a shift, leave or holiday day keeps its kind whatever the contract says", () => {
    const d = buildAgenda(
      start,
      7,
      input({
        contract: fixedMoFr,
        shifts: [shift("2026-11-09", "nord")],
        leave: [
          { startDate: "2026-11-10", endDate: "2026-11-10", status: "APPROVED", label: "Urlaub" },
        ],
        holidays: [{ date: "2026-11-11", name: "Testfeiertag" }],
      }),
    )[0].days;
    expect(d[0].kind).toBe("shift");
    expect(d[1].kind).toBe("leave");
    expect(d[2].kind).toBe("holiday");
    expect(d[3].kind).toBe("unplanned");
  });

  it("SHIFT_BASED: a week without an own shift reads 'Noch nicht geplant' on every day", () => {
    const weeks = buildAgenda(start, 14, input({ contract: shiftBased }));
    for (const day of weeks[0].days) {
      expect(day, day.date).toMatchObject({
        kind: "unplanned",
        title: "Noch nicht geplant",
        subtitle: "Der Plan für diese Woche fehlt noch",
      });
    }
  });

  it("SHIFT_BASED: a week with one shift reads its other days 'Frei'", () => {
    const weeks = buildAgenda(
      start,
      14,
      input({ contract: shiftBased, shifts: [shift("2026-11-11", "nord")] }),
    );
    expect(weeks[0].days[2].kind).toBe("shift");
    expect(weeks[0].days[0]).toMatchObject({ kind: "free", title: "Frei" });
    expect(weeks[0].days[6]).toMatchObject({ kind: "free" });
    // The next week holds no shift of its own: still open.
    expect(weeks[1].days[0]).toMatchObject({ kind: "unplanned" });
  });

  it("the week rule sees a shift of an EARLIER day of the current week, before the window starts", () => {
    // Window starts Thursday 12.11.; the Monday shift of the same ISO week was fetched with it.
    const thursday = new Date(2026, 10, 12);
    const weeks = buildAgenda(
      thursday,
      3,
      input({ contract: shiftBased, shifts: [shift("2026-11-09", "nord")] }),
    );
    for (const day of weeks[0].days) expect(day.kind, day.date).toBe("free");
  });

  it("MONTHLY_HOURS and no contract follow the week rule", () => {
    expect(buildAgenda(start, 7, input({ contract: monthly }))[0].days[0].kind).toBe("unplanned");
    expect(buildAgenda(start, 7, input({ contract: null }))[0].days[0].kind).toBe("unplanned");
    const withShift = input({ contract: null, shifts: [shift("2026-11-12", "nord")] });
    expect(buildAgenda(start, 7, withShift)[0].days[0].kind).toBe("free");
  });

  it("a day before the contract's validFrom follows the week rule, not the fixed workdays", () => {
    const later = { ...fixedMoFr, validFrom: new Date(2026, 10, 11).toISOString() }; // from Mi 11.11.
    const d = buildAgenda(start, 7, input({ contract: later }))[0].days;
    // Monday precedes the contract: the week holds no shift → open, but not "laut Vertrag".
    expect(d[0]).toMatchObject({
      kind: "unplanned",
      subtitle: "Der Plan für diese Woche fehlt noch",
    });
    expect(d[2]).toMatchObject({ kind: "unplanned", subtitle: "Arbeitstag laut Vertrag" });
    expect(d[5]).toMatchObject({ kind: "free" });
  });
});
