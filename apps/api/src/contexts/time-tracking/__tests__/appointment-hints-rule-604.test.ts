// Issue #604 — the pure rule of the appointment hint (D-01, D-03, D-04): no database.
import { describe, it, expect } from "vitest";
import {
  APPOINTMENT_HINT_MIN_GAP_MINUTES,
  evaluateAppointmentHints,
  type EvaluateInput,
} from "../appointment-hints";

const P = "person-1";
const Q = "person-2";
const WINDOW = { fromStr: "2026-03-10", toStr: "2026-03-19" };
const DAY = "2026-03-18";

function entry(
  date: string,
  endLocalTime: string | null,
  opts: { open?: boolean; endsOnLaterDay?: boolean; employeeId?: string } = {},
): EvaluateInput["entries"][number] {
  return {
    employeeId: opts.employeeId ?? P,
    date,
    open: opts.open ?? endLocalTime === null,
    endLocalTime,
    endsOnLaterDay: opts.endsOnLaterDay ?? false,
  };
}

function run(partial: Partial<EvaluateInput>) {
  return evaluateAppointmentHints({
    window: WINDOW,
    appointmentEnds: [],
    entries: [],
    excludedDays: new Set(),
    dismissed: new Set(),
    ...partial,
  });
}

describe("Issue #604 — evaluateAppointmentHints", () => {
  it("the threshold constant is 15 minutes", () => {
    expect(APPOINTMENT_HINT_MIN_GAP_MINUTES).toBe(15);
  });

  it("a last appointment 16 minutes after the clock-out yields AFTER_CLOCK_OUT", () => {
    expect(
      run({
        appointmentEnds: [{ employeeId: P, date: DAY, lastEndTime: "18:16" }],
        entries: [entry(DAY, "18:00")],
      }),
    ).toEqual([
      {
        employeeId: P,
        date: DAY,
        kind: "AFTER_CLOCK_OUT",
        appointmentsUntil: "18:16",
        clockedOutAt: "18:00",
      },
    ]);
  });

  it("exactly 15 minutes is silent (strictly greater)", () => {
    expect(
      run({
        appointmentEnds: [{ employeeId: P, date: DAY, lastEndTime: "18:15" }],
        entries: [entry(DAY, "18:00")],
      }),
    ).toEqual([]);
  });

  it("compares with the LATEST clock-out of several closed entries", () => {
    const hints = run({
      appointmentEnds: [{ employeeId: P, date: DAY, lastEndTime: "19:30" }],
      entries: [entry(DAY, "12:00"), entry(DAY, "17:00")],
    });
    expect(hints).toHaveLength(1);
    expect(hints[0].clockedOutAt).toBe("17:00");
  });

  it("a day with an open entry yields nothing", () => {
    expect(
      run({
        appointmentEnds: [{ employeeId: P, date: DAY, lastEndTime: "19:30" }],
        entries: [entry(DAY, "12:00"), entry(DAY, null, { open: true })],
      }),
    ).toEqual([]);
  });

  it("an invalid but closed entry counts as recorded: AFTER_CLOCK_OUT, never NO_ENTRY (D-03)", () => {
    // the rule input carries no validity flag on purpose - validity never reaches it
    const hints = run({
      appointmentEnds: [{ employeeId: P, date: DAY, lastEndTime: "19:00" }],
      entries: [entry(DAY, "17:00")],
    });
    expect(hints.map((h) => h.kind)).toEqual(["AFTER_CLOCK_OUT"]);
  });

  it("an entry ending on a later local date never yields a hint", () => {
    expect(
      run({
        appointmentEnds: [{ employeeId: P, date: DAY, lastEndTime: "23:50" }],
        entries: [entry(DAY, "00:10", { endsOnLaterDay: true })],
      }),
    ).toEqual([]);
  });

  it("appointments and no entry yield NO_ENTRY with a null clock-out", () => {
    expect(run({ appointmentEnds: [{ employeeId: P, date: DAY, lastEndTime: "16:00" }] })).toEqual([
      {
        employeeId: P,
        date: DAY,
        kind: "NO_ENTRY",
        appointmentsUntil: "16:00",
        clockedOutAt: null,
      },
    ]);
  });

  it("an excluded day yields nothing", () => {
    expect(
      run({
        appointmentEnds: [{ employeeId: P, date: DAY, lastEndTime: "16:00" }],
        excludedDays: new Set([`${P}|${DAY}`]),
      }),
    ).toEqual([]);
  });

  it("a dismissed hint is hidden while a NO_ENTRY of another day stays", () => {
    const hints = run({
      appointmentEnds: [
        { employeeId: P, date: DAY, lastEndTime: "19:30" },
        { employeeId: P, date: "2026-03-17", lastEndTime: "16:00" },
      ],
      entries: [entry(DAY, "18:00")],
      dismissed: new Set([`${P}|${DAY}|AFTER_CLOCK_OUT`]),
    });
    expect(hints.map((h) => `${h.date}:${h.kind}`)).toEqual(["2026-03-17:NO_ENTRY"]);
  });

  it("a dismissal of the other kind does not hide the hint", () => {
    const hints = run({
      appointmentEnds: [{ employeeId: P, date: DAY, lastEndTime: "19:30" }],
      entries: [entry(DAY, "18:00")],
      dismissed: new Set([`${P}|${DAY}|NO_ENTRY`]),
    });
    expect(hints).toHaveLength(1);
  });

  it("a day before the window start or after its end yields nothing", () => {
    expect(
      run({
        appointmentEnds: [
          { employeeId: P, date: "2026-03-09", lastEndTime: "16:00" },
          { employeeId: P, date: "2026-03-20", lastEndTime: "16:00" },
        ],
      }),
    ).toEqual([]);
    // the bounds themselves are inside (inclusive)
    expect(
      run({
        appointmentEnds: [
          { employeeId: P, date: WINDOW.fromStr, lastEndTime: "16:00" },
          { employeeId: P, date: WINDOW.toStr, lastEndTime: "16:00" },
        ],
      }),
    ).toHaveLength(2);
  });

  it("sorts newest day first, then employee id", () => {
    const hints = run({
      appointmentEnds: [
        { employeeId: Q, date: "2026-03-17", lastEndTime: "16:00" },
        { employeeId: Q, date: DAY, lastEndTime: "16:00" },
        { employeeId: P, date: DAY, lastEndTime: "16:00" },
      ],
    });
    expect(hints.map((h) => `${h.date}|${h.employeeId}`)).toEqual([
      `${DAY}|${P}`,
      `${DAY}|${Q}`,
      `2026-03-17|${Q}`,
    ]);
  });
});
