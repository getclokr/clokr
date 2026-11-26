// Issue #992 (N-07, N-08; D-992-12, D-992-17) - the honest Kennzahlen of an empty day and the head
// actions of Heute im Salon.
import { describe, expect, it } from "vitest";
import {
  attendanceBand,
  teamBandTexts,
  teamHeadActions,
  type AttendanceBand,
} from "../heute-im-salon";

function band(overrides: Partial<AttendanceBand> = {}): AttendanceBand {
  return { present: 0, expected: 0, missing: 0, scheduled: 0, absent: 0, done: 0, ...overrides };
}

describe("teamBandTexts", () => {
  it("nobody expected: no „von 0“, no „alle da“", () => {
    const texts = teamBandTexts(band(), null);
    expect(texts.present).toEqual({ unit: undefined, explanation: "niemand erwartet" });
    expect(texts.expected).toEqual({ explanation: "niemand eingeplant" });
  });

  it("an empty day with only absent persons stays honest", () => {
    const texts = teamBandTexts(band({ absent: 3 }), null);
    expect(texts.present.unit).toBeUndefined();
    expect(texts.expected.explanation).not.toContain("alle da");
  });

  it("a normal day keeps the figures of the band", () => {
    const texts = teamBandTexts(band({ present: 2, expected: 4, done: 1, scheduled: 1 }), null);
    expect(texts.present).toEqual({ unit: "von 4", explanation: "1 heute schon gearbeitet" });
    expect(texts.expected.explanation).toBe("kommen noch");
    expect(teamBandTexts(band({ present: 2, expected: 2 }), null).present.explanation).toBe(
      "gerade eingestempelt",
    );
  });

  it("„alle da“ only when someone is expected and nobody is missing or still to come", () => {
    expect(teamBandTexts(band({ present: 2, expected: 2 }), null).expected.explanation).toBe(
      "alle da",
    );
  });

  it("names the first missing person with the shift start and the others as a count", () => {
    const texts = teamBandTexts(band({ expected: 3, missing: 2 }), {
      name: "Timo",
      expectedStart: "09:00",
    });
    expect(texts.expected.explanation).toBe("Timo · Schicht seit 09:00 · +1");
  });

  it("is driven by the real band of an empty attendance answer", () => {
    expect(teamBandTexts(attendanceBand(null), null).present.explanation).toBe("niemand erwartet");
  });
});

describe("teamHeadActions", () => {
  it("each action needs its own create right", () => {
    expect(teamHeadActions({ canAddTeamEntry: false, canRecordTeamAbsence: false })).toEqual([]);
    expect(
      teamHeadActions({ canAddTeamEntry: true, canRecordTeamAbsence: false }).map((a) => a.label),
    ).toEqual(["Zeit eintragen"]);
    expect(
      teamHeadActions({ canAddTeamEntry: false, canRecordTeamAbsence: true }).map((a) => a.label),
    ).toEqual(["Abwesenheit eintragen"]);
  });

  it("targets: Zeiten in the choose-a-person flow, Abwesenheiten with the dialog open", () => {
    const actions = teamHeadActions({ canAddTeamEntry: true, canRecordTeamAbsence: true });
    expect(actions.map((a) => [a.label, a.href, a.tone])).toEqual([
      ["Zeit eintragen", "/team/zeiten?eintragen=1", "outline"],
      ["Abwesenheit eintragen", "/team/abwesenheiten?create=1", "primary"],
    ]);
  });
});
