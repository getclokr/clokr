/**
 * The one place of the German labels of the appearance controls (Issues #975 and #976), wording per
 * docs/glossar.md. The profile section (AppearanceSettings) and the Erscheinungsbild page both take
 * their options from here, so a label exists exactly once.
 *
 * The options that do not name a value come last: the follow-the-device option in the mode control
 * (#975) and the return-to-the-tenant-default option in the Farbwelt control (#976).
 */
import type { ModeChoice } from "$stores/mode";
import { themes, type Theme } from "$stores/theme";

export const MODE_OPTIONS: { value: ModeChoice; label: string }[] = [
  { value: "light", label: "Hell" },
  { value: "dark", label: "Dunkel" },
  { value: "system", label: "Wie Gerät" },
];

// ── Farbwelt (Issue #976) ────────────────────────────────────────────────────────────────────────

/**
 * The value of the control option that returns to the Standard-Farbwelt the Unternehmen set: the person
 * has no own choice. It is a display value only; the request carries `theme: null`.
 */
export const THEME_DEFAULT_VALUE = "betrieb";

/** The Farbwelt options: the three themes, then the return to the Standard des Unternehmens. */
export const THEME_OPTIONS: { value: string; label: string }[] = [
  ...themes.map((t) => ({ value: t.id as string, label: t.label })),
  { value: THEME_DEFAULT_VALUE, label: "Standard des Unternehmens" },
];

/**
 * Which option of the control is shown as checked: while the own choice is not loaded (undefined) the
 * applied theme, null (no own choice) the Standard des Unternehmens, else the choice itself. A display
 * state, not a resolution: the server decides which Farbwelt is applied.
 */
export function themeControlValue(choice: Theme | null | undefined, applied: Theme): string {
  if (choice === undefined) return applied;
  if (choice === null) return THEME_DEFAULT_VALUE;
  return choice;
}

/** The hint under the Farbwelt control; empty while the tenant default is not known. */
export function tenantDefaultHint(tenantDefault: Theme | undefined): string {
  if (!tenantDefault) return "";
  const label = themes.find((t) => t.id === tenantDefault)?.label ?? tenantDefault;
  return `Der Standard deines Unternehmens ist ${label}.`;
}

/** The request of a click on a Farbwelt option: `null` = back to the Standard des Unternehmens. */
export function themeFromControlValue(value: string): Theme | null | undefined {
  if (value === THEME_DEFAULT_VALUE) return null;
  return themes.find((t) => t.id === value)?.id;
}

/** The toast text when saving the appearance fails. */
export const APPEARANCE_SAVE_ERROR =
  "Die Darstellung konnte nicht gespeichert werden. Bitte versuch es noch einmal.";
