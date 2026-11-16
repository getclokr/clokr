import { describe, it, expect } from "vitest";
import { teamEntryWriteError } from "../entry-write-error";

function apiError(message: string, status: number, data?: unknown): Error {
  return Object.assign(new Error(message), { status, data });
}

const ctx = { ownEntry: true, day: "2026-09-30", fallback: "Fehler beim Speichern" };

describe("teamEntryWriteError (Issue #1020)", () => {
  it("explains the Bearbeitungsfenster and links to the own day in Ich › Zeiten", () => {
    const err = apiError("RETRO_WINDOW_EXCEEDED", 403, {
      error: "RETRO_WINDOW_EXCEEDED",
      windowDays: 10,
    });
    expect(teamEntryWriteError(err, ctx)).toEqual({
      text: "Dieser Eintrag liegt außerhalb des Bearbeitungsfensters (10 Tage). Deinen eigenen Eintrag änderst du mit einem Zeitnachtrag unter Ich › Zeiten.",
      link: {
        href: "/ich/zeiten?view=list&date=2026-09-30",
        label: "Tag unter Ich › Zeiten öffnen",
      },
    });
  });

  it("uses the singular for a one-day window and no parenthesis without a number", () => {
    const one = apiError("x", 403, { error: "RETRO_WINDOW_EXCEEDED", windowDays: 1 });
    expect(teamEntryWriteError(one, ctx).text).toContain("(1 Tag)");
    const none = apiError("x", 403, { error: "RETRO_WINDOW_EXCEEDED" });
    expect(teamEntryWriteError(none, ctx).text).toContain("Bearbeitungsfensters.");
    expect(teamEntryWriteError(none, ctx).text).not.toContain("(");
  });

  it("gives the neutral window text without a link for another person's entry or no day", () => {
    const err = apiError("x", 403, { error: "RETRO_WINDOW_EXCEEDED", windowDays: 10 });
    const expected = {
      text: "Dieser Eintrag liegt außerhalb des Bearbeitungsfensters (10 Tage).",
      link: null,
    };
    expect(teamEntryWriteError(err, { ...ctx, ownEntry: false })).toEqual(expected);
    expect(teamEntryWriteError(err, { ...ctx, day: null })).toEqual(expected);
  });

  it("never builds a link from a day that is not YYYY-MM-DD", () => {
    const err = apiError("x", 403, { error: "RETRO_WINDOW_EXCEEDED", windowDays: 10 });
    expect(teamEntryWriteError(err, { ...ctx, day: "2026-09-30&x=1" }).link).toBeNull();
  });

  it("keeps „Monat ist gesperrt“ for a real lock text", () => {
    for (const msg of [
      "Eintrag ist gesperrt und kann nicht gelöscht werden",
      "Der Monat ist bereits abgeschlossen",
    ]) {
      expect(teamEntryWriteError(apiError(msg, 403, { error: msg }), ctx)).toEqual({
        text: "Monat ist gesperrt",
        link: null,
      });
    }
  });

  it("shows the server's message for any other 403 and the fallback when it is empty", () => {
    expect(teamEntryWriteError(apiError("Kein Zugriff", 403), ctx)).toEqual({
      text: "Kein Zugriff",
      link: null,
    });
    expect(teamEntryWriteError(apiError("", 403), ctx).text).toBe("Fehler beim Speichern");
  });

  it("shows the message of a non-403 refusal and the fallback for a non-Error", () => {
    expect(teamEntryWriteError(apiError("Überschneidung mit einem Eintrag", 409), ctx).text).toBe(
      "Überschneidung mit einem Eintrag",
    );
    expect(teamEntryWriteError("boom", ctx)).toEqual({ text: "Fehler beim Speichern", link: null });
  });
});
