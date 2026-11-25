// Issue #604 - the appointment hints as rows of „Für dich“ (Mein Tag): one row per hint, a NO_ENTRY day
// replaces its generic missing row (D-11), and without hints the output is exactly what it was.
import { describe, expect, it } from "vitest";
import { forYouItems } from "../for-you";
import type { OwnAppointmentHint } from "$lib/time-entries/appointment-hints";

const dayShort = (iso: string) => `D${iso}`;
const NO_KARENZ = { count: 0, earliestDay: null, targetRequestId: null, label: "" };

const base = {
  breakDays: [] as string[],
  openItems: {
    missingDays: [] as string[],
    pendingRequests: 0,
    invalidEntries: 0,
  } as Parameters<typeof forYouItems>[0]["openItems"],
  karenz: NO_KARENZ,
  dayShort,
};

const AFTER: OwnAppointmentHint = {
  date: "2026-11-24",
  kind: "AFTER_CLOCK_OUT",
  appointmentsUntil: "19:30",
  clockedOutAt: "18:00",
};
const NONE: OwnAppointmentHint = {
  date: "2026-11-23",
  kind: "NO_ENTRY",
  appointmentsUntil: "16:00",
  clockedOutAt: null,
};

describe("forYouItems with appointment hints (Issue #604)", () => {
  it("one row per hint with the chip, the tone, the action, the tooltip and the dismissal", () => {
    const rows = forYouItems({ ...base, appointmentHints: [AFTER] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: "termin-2026-11-24-AFTER_CLOCK_OUT",
      title: "D2026-11-24: Termine bis 19:30",
      chip: "Prüfen",
      tone: "warn",
      action: "Nachtragen",
      href: "/ich/zeiten?view=list&date=2026-11-24",
      dismiss: { date: "2026-11-24", kind: "AFTER_CLOCK_OUT" },
    });
    expect(rows[0].subtitle).toContain("Ausgestempelt hast du um 18:00");
    expect(rows[0].hint).toContain("Clokr trägt nichts automatisch ein");
  });

  it("the link never carries a time", () => {
    const rows = forYouItems({ ...base, appointmentHints: [AFTER, NONE] });
    for (const r of rows) expect(r.href).not.toMatch(/start|end|time=|19:30|18:00|16:00/);
  });

  it("a NO_ENTRY hint replaces the generic missing row of its day; other missing days stay", () => {
    const rows = forYouItems({
      ...base,
      openItems: {
        missingDays: ["2026-11-23", "2026-11-20"],
        pendingRequests: 0,
        invalidEntries: 0,
      },
      appointmentHints: [NONE],
    });
    expect(rows.map((r) => r.key)).toEqual(["termin-2026-11-23-NO_ENTRY", "miss-2026-11-20"]);
  });

  it("an AFTER_CLOCK_OUT hint does not replace a missing row of the same day", () => {
    const rows = forYouItems({
      ...base,
      openItems: { missingDays: ["2026-11-24"], pendingRequests: 0, invalidEntries: 0 },
      appointmentHints: [AFTER],
    });
    expect(rows.map((r) => r.key)).toEqual([
      "termin-2026-11-24-AFTER_CLOCK_OUT",
      "miss-2026-11-24",
    ]);
  });

  it("hint rows come newest first, right after the break rows", () => {
    const rows = forYouItems({
      ...base,
      breakDays: ["2026-11-10"],
      appointmentHints: [NONE, AFTER],
    });
    expect(rows.map((r) => r.key)).toEqual([
      "break-2026-11-10",
      "termin-2026-11-24-AFTER_CLOCK_OUT",
      "termin-2026-11-23-NO_ENTRY",
    ]);
  });

  it("a malformed day yields no row", () => {
    const rows = forYouItems({ ...base, appointmentHints: [{ ...AFTER, date: "24.11.2026" }] });
    expect(rows).toEqual([]);
  });

  it("without hints (absent or empty) the output is unchanged", () => {
    const input = {
      ...base,
      breakDays: ["2026-11-04"],
      openItems: { missingDays: ["2026-11-05"], pendingRequests: 2, invalidEntries: 0 },
    };
    expect(forYouItems({ ...input, appointmentHints: [] })).toEqual(forYouItems(input));
    expect(forYouItems({ ...input, appointmentHints: undefined })).toEqual(forYouItems(input));
  });
});
