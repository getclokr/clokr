/**
 * Issue #1058 - the plain values of the InfoHint block, in a .ts module so TypeScript test files
 * can import them under `tsc --noEmit` (a named export of a `.svelte` module script is invisible
 * to plain tsc). `InfoHint.svelte` re-exports both, so components keep importing from there.
 */

/** Delay before a hover opens (and closes) the panel; keyboard focus and tap open at once. */
export const HINT_HOVER_DELAY_MS = 150;

/** The accessible name of an InfoHint trigger for the heading, label or value it explains. */
export function hintLabel(subject: string): string {
  return `Erklärung zu „${subject}“`;
}
