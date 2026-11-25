// Issue #606: the ONE place of the German wording of „Wer sieht meine Zeiten?“ and „Warum stempeln?“.
// The server sends only ids (coverage, purpose), role names and one boolean; the web holds no list of
// roles. Every text addresses the reader with du and follows docs/glossar.md. The label maps are
// `Record<…>` over the shared id types, so a new id is a compile error until it has its text.
import type { TimeEntryReaderCoverage, TimeEntryReaderPurpose } from "@clokr/types";

/** How far a role reaches over the person's time entries. */
export const COVERAGE_TEXT: Record<TimeEntryReaderCoverage, string> = {
  wholeTenant: "im ganzen Unternehmen",
  homeSalon: "zuständig für deinen Stammsalon",
  workSalon:
    "zuständig für einen weiteren Salon von dir – nur deine Zeiten, die zu diesem Salon gehören",
  person: "dir persönlich zugewiesen",
};

/** Why a role reads time entries. */
export const PURPOSE_TEXT: Record<TimeEntryReaderPurpose, string> = {
  hours: "Stundenkonto",
  payroll: "Lohnabrechnung",
  protection: "Arbeitsschutz",
};

/** „Zweck: Stundenkonto, Lohnabrechnung und Arbeitsschutz“ (German list join). */
export function purposeLine(purposes: readonly TimeEntryReaderPurpose[]): string {
  const names = purposes.map((purpose) => PURPOSE_TEXT[purpose]);
  if (names.length === 0) return "";
  if (names.length === 1) return `Zweck: ${names[0]}`;
  return `Zweck: ${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
}

export const READERS_TEXT = {
  title: "Wer sieht meine Zeiten?",
  intro: "Diese Rollen in deinem Unternehmen können deine Zeiteinträge und Pausen lesen:",
  hint: "Die Liste kommt aus den Rollen, die dein Unternehmen vergeben hat. Ändert sich eine Zuweisung, ändert sich die Liste sofort. Namen zeigen wir hier nicht.",
  empty: "Gerade kann keine andere Rolle deine Zeiteinträge lesen.",
  loadError: "Die Liste ließ sich nicht laden.",
  listLabel: "Rollen mit Lesezugriff",
} as const;

/** Readers outside the role assignments (Issue #606, D-05): connected programs and the Clokr support. */
export const PROGRAMS_TEXT = {
  title: "Angebundene Programme deines Unternehmens",
  subtitle:
    "über eine Schnittstelle, die deine Administration eingerichtet hat – sie können alle Zeiten lesen",
  purpose: "Zweck: legt dein Unternehmen fest, zum Beispiel die Lohnabrechnung",
  supportNote:
    "Der Clokr-Support sieht deine Zeiten nur in einem Supportfall: zeitlich begrenzt, mit Begründung und protokolliert. Deine Administration wird dabei benachrichtigt.",
} as const;
