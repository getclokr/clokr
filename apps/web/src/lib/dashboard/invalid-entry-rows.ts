/**
 * Issue #1020 — the ONE place Mein Tag turns the open-items invalid entries into „Für dich“ rows.
 *
 * `GET /dashboard/open-items` names each own invalid or still-open entry by day (`invalidEntryDays`,
 * the same rows as the `invalidEntries` count). This module words one row per day and links into the
 * place that fixes it: an open entry into the „Ende eintragen“ flow of Zeiten, any other invalid day
 * into the day's list.
 *
 * Issue #1028 (P-07): every day is a row, newest first - the cap of five days and its summary row
 * „N weitere Tage zu prüfen“ are gone; the list widget pages them.
 *
 * No figure is computed: an invalid entry counts nowhere until it is fixed. An older API answer
 * without the day list keeps today's single count row.
 */
import { endEntryHref } from "$lib/time-entries/open-earlier-entry";
import { countWord } from "$lib/utils/count-word";

export interface InvalidEntryDay {
  /** The entry's own calendar day, `YYYY-MM-DD`. */
  date: string;
  entryId: string;
  /** True when the entry has no end time yet. */
  open: boolean;
}

export interface InvalidEntryRow {
  key: string;
  title: string;
  subtitle: string;
  chip: string;
  tone: "warn";
  href: string;
  action: string;
  testId?: string;
}

interface InvalidEntryAnswer {
  invalidEntries: number;
  invalidEntryDays?: readonly InvalidEntryDay[];
}

export function invalidEntryRows(
  answer: InvalidEntryAnswer | null | undefined,
  dayShort: (iso: string) => string,
): InvalidEntryRow[] {
  const count = answer?.invalidEntries ?? 0;
  if (!answer || count <= 0) return [];

  const days = answer.invalidEntryDays;
  if (!days) {
    return [
      {
        key: "invalid",
        title: countWord(count, "Eintrag", "Einträge") + " zu korrigieren",
        subtitle: "Bitte prüfen und korrigieren.",
        chip: "Prüfen",
        tone: "warn",
        href: "/ich/zeiten",
        action: "Öffnen",
      },
    ];
  }

  const distinctDays = [...new Set(days.map((d) => d.date))].sort().reverse();
  const rows: InvalidEntryRow[] = [];
  for (const day of distinctDays) {
    const open = days.find((d) => d.date === day && d.open);
    if (open) {
      rows.push({
        key: `invalid-${day}`,
        title: `${dayShort(day)} Ausstempeln fehlt`,
        subtitle: "Trag das Ende ein – solange es fehlt, zählt die Zeit nicht.",
        chip: "Prüfen",
        tone: "warn",
        href: endEntryHref({ id: open.entryId, day }),
        action: "Ende eintragen",
      });
    } else {
      rows.push({
        key: `invalid-${day}`,
        title: `${dayShort(day)} Eintrag prüfen`,
        subtitle: "Bitte prüfen und korrigieren.",
        chip: "Prüfen",
        tone: "warn",
        href: `/ich/zeiten?view=list&date=${day}`,
        action: "Öffnen",
      });
    }
  }
  return rows;
}
