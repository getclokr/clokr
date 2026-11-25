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

/**
 * The label of a skipped cell in the "Woche kopieren" preview: the same short label as "Muster
 * anwenden" (the section heading already says „Übersprungen“). A reason copy never gives — or an
 * unknown one — reads „Übersprungen“, never „Kein Muster“.
 */
export function copySkipLabel(reason: RosterSkipReason): string {
  if (reason === "no-pattern" || reason === "open-day" || !SKIP_ORDER.includes(reason)) {
    return "Übersprungen";
  }
  return generateSkipLabel(reason);
}

/**
 * The order of the skip list: a rule that blocked the cell first (law, opening hours, past days,
 * contract), then the person's own state, the "nothing to plan" reasons last — so the reasons that
 * need a look are not buried under dozens of „Kein Muster“ rows.
 */
const SKIP_ORDER: readonly RosterSkipReason[] = [
  "jarbschg",
  "arbzg-daily-max",
  "arbzg-rest-period",
  "outside-store-hours",
  "past",
  "no-contract",
  "leave",
  "absence",
  "availability-unavailable",
  "existing",
  "open-day",
  "no-pattern",
];

/** The skipped cells in display order (stable within one reason). */
export function sortSkips<T extends { reason: RosterSkipReason }>(skips: readonly T[]): T[] {
  const rank = (r: RosterSkipReason) => {
    const at = SKIP_ORDER.indexOf(r);
    return at === -1 ? SKIP_ORDER.length : at;
  };
  return skips
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s.reason) - rank(b.s.reason) || a.i - b.i)
    .map(({ s }) => s);
}
