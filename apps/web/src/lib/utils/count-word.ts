/**
 * Issue #946 — the ONE place a count and its noun are joined: "1 Monat", "2 Monate". A caller
 * writing `${n} Monate` shows "1 Monate" for one, so every count word that can be 1 goes through
 * here. `plural` is the full plural form, never derived by appending a suffix.
 */
export function countWord(n: number, singular: string, plural: string): string {
  return `${n} ${countNoun(n, singular, plural)}`;
}

/** Only the noun of `countWord`, for a figure shown apart from its unit (a KPI value and its unit, #1114). */
export function countNoun(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

export const monthsLabel = (n: number): string => countWord(n, "Monat", "Monate");
export const personsLabel = (n: number): string => countWord(n, "Person", "Personen");
