// Issue #1085 - the own time page and a day that still has an OPEN entry.
//
// The owner's report: a day outside the 10-day window carries an entry that was started (08:30)
// and never ended. The dialog opened as "Neuer Eintrag", the person entered 08:30-12:30 plus a
// reason, and "Antrag stellen" answered 409 "Überschneidung mit bestehendem Eintrag ... (08:30 -
// läuft)". The submit branched on `editEntry` alone: with `editEntry === null` it filed an
// entry-first Zeitnachtrag (`POST /time-entries` + reason), which the server's overlap check
// refuses against the open entry, and the correction path (`POST /retro-entry-requests`, applied
// by #1021 so that it ends the open entry) was never taken.
//
// These tests pin the decisions that now route such a day to the correction: which open entry a
// proposed interval collides with, which submit path a Zeitnachtrag takes, and the wording.
import { describe, it, expect } from "vitest";
import {
  OPEN_ENTRY_TEXTS,
  openEntryActionLabel,
  openEntryClash,
  openEntryDialogEyebrow,
  retroOpenEntryTarget,
  retroSubmitPath,
} from "../open-entry-correction";
import type { DayEntryRow } from "../day-entry-actions";

const DAY = "2026-07-02";

function at(hhmm: string): Date {
  return new Date(`${DAY}T${hhmm}:00`);
}

function row(id: string, start: string, end: string | null, extra: Partial<DayEntryRow> = {}) {
  return {
    id,
    date: DAY,
    startTime: at(start).toISOString(),
    endTime: end === null ? null : at(end).toISOString(),
    ...extra,
  } satisfies DayEntryRow;
}

describe("openEntryClash - the open entry a proposed interval collides with", () => {
  const open = row("run", "08:30", null);

  it("an interval ending after the open entry's start collides (the server's overlap rule)", () => {
    expect(openEntryClash([open], at("12:30"))).toBe(open);
    expect(openEntryClash([open], at("08:31"))).toBe(open);
  });

  it("an interval that ends exactly at, or before, the start does not collide", () => {
    expect(openEntryClash([open], at("08:30"))).toBeNull();
    expect(openEntryClash([open], at("08:00"))).toBeNull();
  });

  it("an interval without an end always collides: an open entry runs to the end of its day", () => {
    expect(openEntryClash([open], null)).toBe(open);
  });

  it("closed rows and a locked open row never collide", () => {
    expect(openEntryClash([row("a", "08:00", "12:00")], at("12:30"))).toBeNull();
    expect(openEntryClash([row("l", "08:30", null, { isLocked: true })], at("12:30"))).toBeNull();
    expect(openEntryClash([], at("12:30"))).toBeNull();
  });
});

describe("retroSubmitPath - which request a Zeitnachtrag becomes", () => {
  const open = row("run", "08:30", null);
  const closed = row("a", "08:00", "12:00");

  it("the prod case: a NEW form on a day with an open entry files the correction, not a second entry", () => {
    // editEntry === null, the person typed 08:30 - 12:30 over the open 08:30 entry.
    expect(
      retroSubmitPath({ editEntry: null, dayEntries: [open], proposedEnd: at("12:30") }),
    ).toEqual({ kind: "correction", target: open });
  });

  it("an entry being edited always files the correction (the unchanged #96 branch)", () => {
    expect(
      retroSubmitPath({ editEntry: closed, dayEntries: [closed], proposedEnd: at("17:00") }),
    ).toEqual({ kind: "correction", target: null });
    expect(
      retroSubmitPath({ editEntry: open, dayEntries: [open], proposedEnd: at("12:30") }),
    ).toEqual({ kind: "correction", target: open });
  });

  it("a new interval on a day without an open entry stays an entry-first Zeitnachtrag", () => {
    expect(retroSubmitPath({ editEntry: null, dayEntries: [], proposedEnd: at("12:30") })).toEqual({
      kind: "entry-first",
    });
    expect(
      retroSubmitPath({ editEntry: null, dayEntries: [closed], proposedEnd: at("17:00") }),
    ).toEqual({ kind: "entry-first" });
  });

  it("a new interval that ends before the open entry starts is a valid second interval", () => {
    expect(
      retroSubmitPath({ editEntry: null, dayEntries: [open], proposedEnd: at("08:00") }),
    ).toEqual({ kind: "entry-first" });
  });
});

describe("retroOpenEntryTarget - the open entry a retro form is about", () => {
  const open = row("run", "08:30", null);

  it("the edited entry, when it is still open", () => {
    expect(
      retroOpenEntryTarget({ editEntry: open, dayEntries: [open], proposedEnd: at("12:30") }),
    ).toBe(open);
  });

  it("a NEW form on a day with a colliding open entry names that entry", () => {
    expect(
      retroOpenEntryTarget({ editEntry: null, dayEntries: [open], proposedEnd: at("12:30") }),
    ).toBe(open);
  });

  it("a closed edited entry and a plain new form name none", () => {
    const closed = row("a", "08:00", "12:00");
    expect(
      retroOpenEntryTarget({ editEntry: closed, dayEntries: [closed], proposedEnd: at("17:00") }),
    ).toBeNull();
    expect(
      retroOpenEntryTarget({ editEntry: null, dayEntries: [], proposedEnd: at("17:00") }),
    ).toBeNull();
  });
});

describe("openEntryDialogEyebrow - what the dialog calls itself", () => {
  it("an open entry of an EARLIER day reads „Ausstempeln nachtragen“", () => {
    expect(openEntryDialogEyebrow(row("run", "08:30", null), "2026-11-25")).toBe(
      "Ausstempeln nachtragen",
    );
  });

  it("today's running entry and a closed entry keep „Eintrag bearbeiten“", () => {
    expect(openEntryDialogEyebrow(row("run", "08:30", null), DAY)).toBe("Eintrag bearbeiten");
    expect(openEntryDialogEyebrow(row("a", "08:00", "12:00"), "2026-11-25")).toBe(
      "Eintrag bearbeiten",
    );
  });

  it("a new form is „Neuer Eintrag“", () => {
    expect(openEntryDialogEyebrow(null, "2026-11-25")).toBe("Neuer Eintrag");
  });
});

describe("openEntryActionLabel - the button that opens the open entry", () => {
  it("names the forgotten clock-out of an earlier day, and today's running entry plainly", () => {
    expect(openEntryActionLabel(row("run", "08:30", null), "2026-11-25")).toBe(
      "Ausstempeln nachtragen",
    );
    expect(openEntryActionLabel(row("run", "08:30", null), DAY)).toBe("Ende eintragen");
  });
});

describe("the wording (du, glossar.md)", () => {
  it("names the open entry's start and says that the request ends it", () => {
    const callout = OPEN_ENTRY_TEXTS.retroCallout("08:30", 10);
    expect(callout).toContain("08:30");
    expect(callout).toContain("10 Tage");
    expect(callout).toMatch(/Antrag/);
    expect(callout).toMatch(/beendet/);
  });

  it("counts one day in the singular", () => {
    expect(OPEN_ENTRY_TEXTS.retroCallout("08:30", 1)).toContain("1 Tag)");
  });

  it("never addresses the reader with Sie", () => {
    const texts = [
      OPEN_ENTRY_TEXTS.retroCallout("08:30", 10),
      OPEN_ENTRY_TEXTS.endRequired,
      OPEN_ENTRY_TEXTS.openHint,
      OPEN_ENTRY_TEXTS.switchedToOpenEntry("08:30"),
    ];
    for (const text of texts) expect(text).not.toMatch(/\b(Sie|Ihnen|Ihr|Ihre)\b/);
  });
});
