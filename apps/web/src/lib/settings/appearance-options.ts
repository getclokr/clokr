/**
 * The one place of the German labels of the appearance controls (Issues #975 and #976), wording per
 * docs/glossar.md. The profile section (AppearanceSettings) and the Erscheinungsbild page both take
 * their options from here, so a label exists exactly once.
 *
 * The follow-the-device option comes last, mirroring the option that returns to the Standard des
 * Unternehmens in the Farbwelt control (#976).
 */
import type { ModeChoice } from "$stores/mode";

export const MODE_OPTIONS: { value: ModeChoice; label: string }[] = [
  { value: "light", label: "Hell" },
  { value: "dark", label: "Dunkel" },
  { value: "system", label: "Wie Gerät" },
];
