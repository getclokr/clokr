// Issue #1075 — the reasons "Muster anwenden" and "Woche kopieren" give for a cell they skip, and
// the short label each one gets in the preview. The six rule reasons mirror
// `SHIFT_WRITE_SKIP_REASON` in `apps/api/src/contexts/scheduling/shift-write-checks.ts` by hand
// (the web does not import the API); the German sentence behind a reason travels in `message`.

export type RosterSkipReason =
  | "leave"
  | "absence"
  | "existing"
  | "no-pattern"
  | "open-day"
  | "availability-unavailable"
  | "jarbschg"
  | "no-contract"
  | "past"
  | "outside-store-hours"
  | "arbzg-daily-max"
  | "arbzg-rest-period";

/** The label of a skipped cell in the "Muster anwenden" preview. */
export function generateSkipLabel(reason: RosterSkipReason): string {
  switch (reason) {
    case "leave":
      return "Urlaub";
    case "absence":
      return "Abwesenheit";
    case "existing":
      return "Schicht existiert";
    case "open-day":
      return "Frei nach Muster";
    case "availability-unavailable":
      return "Nicht verfügbar";
    case "jarbschg":
      return "Jugendarbeitsschutz";
    case "past":
      return "Vergangener Tag";
    case "no-contract":
      return "Kein Vertrag";
    case "outside-store-hours":
      return "Außerhalb der Öffnungszeiten";
    case "arbzg-daily-max":
      return "Über 10 Stunden am Tag";
    case "arbzg-rest-period":
      return "Ruhezeit unter 11 Stunden";
    case "no-pattern":
    default:
      return "Kein Muster";
  }
}

/** The label of a skipped cell in the "Woche kopieren" preview. */
export function copySkipLabel(reason: RosterSkipReason): string {
  switch (reason) {
    case "leave":
      return "Übersprungen — Urlaub";
    case "absence":
      return "Übersprungen — Krankheit";
    case "existing":
      return "Übersprungen — Schicht existiert bereits";
    case "availability-unavailable":
      return "Übersprungen — nicht verfügbar";
    case "jarbschg":
      return "Übersprungen — Jugendarbeitsschutz";
    case "past":
      return "Übersprungen — vergangener Tag";
    case "no-contract":
      return "Übersprungen — kein Vertrag";
    case "outside-store-hours":
      return "Übersprungen — außerhalb der Öffnungszeiten";
    case "arbzg-daily-max":
      return "Übersprungen — über 10 Stunden am Tag";
    case "arbzg-rest-period":
      return "Übersprungen — Ruhezeit unter 11 Stunden";
    default:
      return "Übersprungen";
  }
}
