// Issue #992 (N-11, N-12, N-21; D-992-19..21) — the plain-German pieces of the Dienstplan.
import { describe, it, expect } from "vitest";
import { staffingTone } from "../staffing";
import {
  PREVIEW_FAILED_TEXT,
  copyButtonText,
  generateButtonText,
  rosterRequestError,
  shiftsLabel,
  skippedLine,
} from "../roster-request-error";
import { differenceLabel, plannedLabel } from "../planning-week";

/** The shape of an `ApiError` of `$api/client` (status + the parsed answer), without importing it. */
function apiError(status: number, data: unknown): Error {
  return Object.assign(new Error("Fehler"), { status, data });
}

describe("staffingTone (D-992-21)", () => {
  it("gives the desktop tone of every state", () => {
    expect(staffingTone("ok", false)).toBe("ok");
    expect(staffingTone("under", false)).toBe("bad");
    expect(staffingTone("supervision-missing", false)).toBe("warn");
  });

  it("never reads a closed day as a shortfall", () => {
    expect(staffingTone("under", true)).toBe("closed");
    expect(staffingTone("ok", true)).toBe("closed");
  });

  it("reads a missing status as ok", () => {
    expect(staffingTone(undefined, false)).toBe("ok");
  });
});

describe("rosterRequestError (D-992-19, T-992-05)", () => {
  it("never shows the text of a browser exception", () => {
    expect(rosterRequestError(new TypeError("Failed to fetch"), PREVIEW_FAILED_TEXT)).toBe(
      "Die Vorschau konnte nicht geladen werden. Prüf deine Verbindung und versuch es noch einmal.",
    );
    expect(
      rosterRequestError(new Error("NetworkError when attempting"), "Kopieren fehlgeschlagen."),
    ).toBe("Kopieren fehlgeschlagen.");
  });

  it("keeps the German message of an API refusal", () => {
    expect(
      rosterRequestError(
        apiError(422, { error: "Fehler", message: "Die Woche ist gesperrt." }),
        "x",
      ),
    ).toBe("Fehler: Die Woche ist gesperrt.");
    expect(rosterRequestError(apiError(500, undefined), "Kopieren fehlgeschlagen.")).toBe(
      "Kopieren fehlgeschlagen.",
    );
  });

  it("falls back for a value that is no error at all", () => {
    expect(rosterRequestError("boom", "Fallback")).toBe("Fallback");
    expect(rosterRequestError(null, "Fallback")).toBe("Fallback");
  });
});

describe("count texts (D-992-19)", () => {
  it("counts shifts", () => {
    expect(shiftsLabel(1)).toBe("1 Schicht");
    expect(shiftsLabel(3)).toBe("3 Schichten");
    expect(shiftsLabel(0)).toBe("0 Schichten");
  });

  it("words the copy and generate buttons", () => {
    expect(copyButtonText(3)).toBe("3 Schichten übernehmen");
    expect(copyButtonText(1)).toBe("1 Schicht übernehmen");
    expect(generateButtonText(1)).toBe("1 Schicht erstellen");
    expect(generateButtonText(4)).toBe("4 Schichten erstellen");
  });

  it("words the skipped entries", () => {
    expect(skippedLine(2)).toBe("2 Einträge werden übersprungen");
    expect(skippedLine(1)).toBe("1 Eintrag wird übersprungen");
  });
});

describe("Bedarf cells (D-992-20)", () => {
  it("prints the planned days in one form", () => {
    expect(plannedLabel(5)).toBe("5 Tage");
    expect(plannedLabel(1)).toBe("1 Tag");
    expect(plannedLabel(undefined)).toBe("–");
  });

  it("signs the difference", () => {
    expect(differenceLabel(1)).toBe("+1 Tag");
    expect(differenceLabel(-2)).toBe("−2 Tage");
    expect(differenceLabel(0)).toBe("0 Tage");
    expect(differenceLabel(1.5)).toBe("+1,5 Tage");
    expect(differenceLabel(undefined)).toBe("–");
  });
});
