/**
 * Issue #1020 — the ONE mapping of a Team › Zeiten save/delete refusal to shown text.
 *
 * A 403 is not always a lock: the manager exemption of the retro window covers only OTHER people's
 * entries, so a person editing their OWN old entry here gets `RETRO_WINDOW_EXCEEDED`. They are told
 * the truth and sent to Ich › Zeiten, where the Zeitnachtrag form applies. Display only: no request,
 * no permission read, no write path changes.
 */
import { countWord } from "$lib/utils/count-word";

export interface EntryWriteErrorText {
  text: string;
  /** A real anchor shown after the text, or `null`. */
  link: { href: string; label: string } | null;
}

interface WriteErrorContext {
  /** The entry belongs to the signed-in person. */
  ownEntry: boolean;
  /** The entry's calendar day, `YYYY-MM-DD`, when known. */
  day: string | null;
  /** The text for an error that carries no message of its own. */
  fallback: string;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function teamEntryWriteError(err: unknown, ctx: WriteErrorContext): EntryWriteErrorText {
  const status = (err as { status?: unknown } | null)?.status;
  const data = (err as { data?: { error?: unknown; windowDays?: unknown } } | null)?.data;
  const message = err instanceof Error && err.message ? err.message : "";

  if (status === 403) {
    // The code is the control value, never the German text.
    if (data?.error === "RETRO_WINDOW_EXCEEDED") {
      const days =
        typeof data.windowDays === "number" && Number.isFinite(data.windowDays)
          ? ` (${countWord(data.windowDays, "Tag", "Tage")})`
          : "";
      const base = `Dieser Eintrag liegt außerhalb des Bearbeitungsfensters${days}.`;
      if (ctx.ownEntry && ctx.day && DAY_PATTERN.test(ctx.day)) {
        return {
          text: `${base} Deinen eigenen Eintrag änderst du mit einem Zeitnachtrag unter Ich › Zeiten.`,
          link: {
            href: `/ich/zeiten?view=list&date=${ctx.day}`,
            label: "Tag unter Ich › Zeiten öffnen",
          },
        };
      }
      return { text: base, link: null };
    }
    const serverText = typeof data?.error === "string" && data.error ? data.error : message;
    if (/abgeschlossen|gesperrt/.test(serverText)) {
      return { text: "Monat ist gesperrt", link: null };
    }
  }
  return { text: message || ctx.fallback, link: null };
}
