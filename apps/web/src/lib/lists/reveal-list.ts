/**
 * Issue #1028 - keep the new page of a list widget in sight after a page change (Issue #710 visibility).
 *
 * A widget keeps its height while it pages (its body reserves the tallest page), so the last, shorter page
 * leaves an empty space between its rows and the pager at the bottom. A person who clicks „Nächste Seite“
 * there has the pager on screen, but on a narrow screen (rows are tall cards) the first row of the new
 * page can lie above the top edge of the screen: the pager text changes („6–7 von 7“), the visible area
 * is blank and the click looks like it did nothing. (A `DataTable` reserves nothing, its rows stay right
 * above its pager, so the browser's own scroll clamp keeps them together and it needs no reveal.)
 *
 * After a person-made page change the widget scrolls its top back under the top bar - but only when the
 * FIRST ROW of the new page is not on screen at all, so a widget whose rows are visible never jumps.
 */

/** Height of the sticky top bar in px: a row that ends above this line is hidden under the bar. */
export const TOPBAR_HEIGHT = 48;

/**
 * The first row of a list, in both of its shapes: an `li` of a `List` and a `tbody tr` of a table (a
 * stacked card on a phone is a `tr` as well).
 */
export const FIRST_ROW_SELECTOR = "li, tbody tr";

/**
 * Whether the first row of `root` (or `root` itself when it has no row) shows on screen, at least in
 * part: it ends below the top bar and starts above the bottom edge of the window.
 */
export function firstRowIsInView(root: Element, viewportHeight: number): boolean {
  const box = (root.querySelector(FIRST_ROW_SELECTOR) ?? root).getBoundingClientRect();
  return box.bottom > TOPBAR_HEIGHT && box.top < viewportHeight;
}

/**
 * Scrolls `root` (the widget section, which carries a `scroll-margin-top` that clears the top bar) to the
 * top of the screen unless its first row is on screen. Instant, not smooth:
 * the rows change at once, so the view changes with them. Safe without a window (SSR) and without
 * `scrollIntoView` (jsdom).
 */
export function revealListTop(root: HTMLElement | null | undefined): void {
  if (!root || typeof window === "undefined") return;
  if (firstRowIsInView(root, window.innerHeight)) return;
  root.scrollIntoView?.({ block: "start", behavior: "auto" });
}
