// Issue #992 (N-11, D-992-19, T-992-05) — what the Dienstplan dialogs and toasts SAY when a request
// fails or counts something. A browser exception ("Failed to fetch") is English and means nothing to
// the reader, so only the German message of an API refusal or a German fallback ever reaches the screen.
//
// Dependency-free: no `$api` import (the client needs `$app` and cannot load in a unit test), so an
// API refusal is recognised by its shape (a numeric `status` next to the parsed answer in `data`).

import { errorMessage } from "../api/error-message";
import { countWord } from "../utils/count-word";

/** The sentence of a preview that never reached the server. */
export const PREVIEW_FAILED_TEXT =
  "Die Vorschau konnte nicht geladen werden. Prüf deine Verbindung und versuch es noch einmal.";

function isApiRefusal(err: unknown): err is Error & { status: number; data?: unknown } {
  return err instanceof Error && typeof (err as { status?: unknown }).status === "number";
}

/** The text to show for a failed request: the server's German message, else `fallback`. */
export function rosterRequestError(err: unknown, fallback: string): string {
  if (isApiRefusal(err)) return errorMessage(err.data, fallback);
  return fallback;
}

/** "1 Schicht", "3 Schichten". */
export const shiftsLabel = (n: number): string => countWord(n, "Schicht", "Schichten");

/** The confirm button of the copy dialog: "3 Schichten übernehmen". */
export const copyButtonText = (n: number): string => `${shiftsLabel(n)} übernehmen`;

/** The confirm button of the generate dialog: "1 Schicht erstellen". */
export const generateButtonText = (n: number): string => `${shiftsLabel(n)} erstellen`;

/** The skipped-entries line of a preview, with the verb agreeing in number. */
export function skippedLine(n: number): string {
  return n === 1 ? "1 Eintrag wird übersprungen" : `${n} Einträge werden übersprungen`;
}
