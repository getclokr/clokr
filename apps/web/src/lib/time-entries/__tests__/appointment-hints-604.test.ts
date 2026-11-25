// Issue #604 - the display texts, the day link and the dismissal call of an appointment hint. Every
// hint is the server's decision; these functions only word it.
import { describe, expect, it, vi } from "vitest";
import {
  APPOINTMENT_HINT_PATHS,
  APPOINTMENT_HINT_TOOLTIP,
  appointmentHintHref,
  appointmentHintTexts,
  dismissAppointmentHint,
  type OwnAppointmentHint,
} from "../appointment-hints";

const AFTER: OwnAppointmentHint = {
  date: "2026-11-24",
  kind: "AFTER_CLOCK_OUT",
  appointmentsUntil: "19:30",
  clockedOutAt: "18:00",
};
const NONE: OwnAppointmentHint = {
  date: "2026-11-24",
  kind: "NO_ENTRY",
  appointmentsUntil: "16:00",
  clockedOutAt: null,
};

describe("appointmentHintTexts (Issue #604)", () => {
  it("words an after-clock-out hint with the day, the appointment end and the clock-out", () => {
    expect(appointmentHintTexts(AFTER, "Di 24.11.")).toEqual({
      title: "Di 24.11.: Termine bis 19:30",
      subtitle:
        "Ausgestempelt hast du um 18:00. Falls du länger gearbeitet hast, fehlt diese Zeit in deinem Stundenkonto.",
    });
  });

  it("words a no-entry hint conditionally", () => {
    expect(appointmentHintTexts(NONE, "Di 24.11.")).toEqual({
      title: "Di 24.11.: Termine, aber keine Zeit erfasst",
      subtitle:
        "Dein letzter Termin endete um 16:00. Falls du gearbeitet hast, fehlt diese Zeit in deinem Stundenkonto.",
    });
  });

  it("never names the appointment system", () => {
    const all = JSON.stringify([
      appointmentHintTexts(AFTER, "Di 24.11."),
      appointmentHintTexts(NONE, "Di 24.11."),
      APPOINTMENT_HINT_TOOLTIP,
    ]);
    expect(all).not.toMatch(/phorest/i);
  });
});

describe("appointmentHintHref (Issue #604, D-13)", () => {
  it("opens the day of the list and carries no time parameter", () => {
    expect(appointmentHintHref("2026-11-24")).toBe("/ich/zeiten?view=list&date=2026-11-24");
  });

  it("answers null for a malformed day", () => {
    expect(appointmentHintHref("24.11.2026")).toBeNull();
    expect(appointmentHintHref("2026-11-24T10:00")).toBeNull();
    expect(appointmentHintHref("")).toBeNull();
  });
});

describe("dismissAppointmentHint (Issue #604)", () => {
  it("posts the day and the kind - and nothing else - to the dismissal path", async () => {
    const post = vi.fn().mockResolvedValue({ dismissal: {} });
    await dismissAppointmentHint({ post }, AFTER);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/appointment-hints/dismissals", {
      date: "2026-11-24",
      kind: "AFTER_CLOCK_OUT",
    });
  });

  it("has the three paths of the API", () => {
    expect(APPOINTMENT_HINT_PATHS).toEqual({
      own: "/appointment-hints",
      team: "/appointment-hints/team",
      dismiss: "/appointment-hints/dismissals",
    });
  });
});
