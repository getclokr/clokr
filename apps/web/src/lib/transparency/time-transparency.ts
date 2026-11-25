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
  loadError: "Die Liste konnte nicht abgerufen werden.",
  listLabel: "Rollen mit Lesezugriff",
} as const;

/**
 * „Warum stempeln?“ (Issue #606, D-12). DRAFT for the owner's wording review: the legal anchors are
 * named on purpose (EuGH C-55/18 of 14.05.2019, BAG 1 ABR 22/21 of 13.09.2022, § 3 Abs. 2 Nr. 1
 * ArbSchG, § 16 Abs. 2 ArbZG, §§ 3 bis 5 ArbZG). Dropping § 26 BDSG from the profile footnote is
 * one edit here (since EuGH C-34/21 of 30.03.2023 it is doubtful as a „more specific rule“).
 */
export const WHY_CLOCK_TEXT = {
  title: "Warum stempeln?",
  points: [
    {
      title: "Das Gesetz verlangt es",
      text: "Dein Unternehmen muss deine gesamte Arbeitszeit erfassen: Beginn, Ende und Dauer. So haben es der Europäische Gerichtshof (C-55/18, 2019) und das Bundesarbeitsgericht (1 ABR 22/21, 2022) entschieden (§ 3 Abs. 2 Nr. 1 ArbSchG, § 16 Abs. 2 ArbZG). Mit dem Stempeln erledigst du das in Sekunden.",
    },
    {
      title: "Schutz vor unbezahlter Arbeit",
      text: "Was du stempelst, ist belegt: Mehrarbeit geht nicht unter. Clokr prüft Pausen, Ruhezeiten und die Höchstarbeitszeit (§§ 3 bis 5 ArbZG), damit du nicht zu lange am Stück arbeitest.",
    },
    {
      title: "Jede Minute zählt für dein Konto",
      text: "Deine gestempelten Zeiten fließen direkt in dein Stundenkonto. Was fehlt, fehlt auch dort. Vergessen? Trag die Zeit unter Ich › Zeiten nach.",
    },
  ],
  // The footer reads „<footerLead><link><footerEnd>“ - the link names the profile section.
  footerLead: "Wer deine Zeiten sieht, steht im Profil unter ",
  footerLinkLabel: "„Wer sieht meine Zeiten?“",
  footerEnd: ".",
  legalBasis:
    "Zweck und Rechtsgrundlage: Dein Unternehmen verarbeitet deine Zeiten für dein Stundenkonto, die Lohnabrechnung und den Arbeitsschutz – zur Durchführung deines Arbeitsvertrags und weil das Gesetz die Erfassung verlangt (Art. 6 Abs. 1 lit. b und c DSGVO, § 26 Abs. 1 BDSG, § 3 Abs. 2 Nr. 1 ArbSchG, § 16 Abs. 2 ArbZG). Die vollständigen Datenschutzhinweise bekommst du von deinem Unternehmen.",
  understood: "Verstanden",
  skip: "Überspringen",
  reopen: "„Warum stempeln?“ ansehen",
  close: "Schließen",
  dismissFailed: "Der Einstieg ließ sich nicht ausblenden. Er erscheint beim nächsten Mal wieder.",
} as const;

/** Where the footer of the intro points: the profile section (anchor of TimeEntryReadersSettings). */
export const READERS_ANCHOR_HREF = "/ich/profil#wer-sieht-meine-zeiten";

/** Readers outside the role assignments (Issue #606, D-05): connected programs and the Clokr support. */
export const PROGRAMS_TEXT = {
  title: "Angebundene Programme deines Unternehmens",
  subtitle:
    "über eine Schnittstelle, die deine Administration eingerichtet hat – sie können alle Zeiten lesen",
  purpose: "Zweck: legt dein Unternehmen fest, zum Beispiel die Lohnabrechnung",
  supportNote:
    "Der Clokr-Support sieht deine Zeiten nur in einem Supportfall: zeitlich begrenzt, mit Begründung und protokolliert. Deine Administration wird dabei benachrichtigt.",
} as const;
