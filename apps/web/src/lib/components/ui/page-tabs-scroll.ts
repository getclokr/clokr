/**
 * Issue #978 - where a sideways-scrolling tab strip must stand so that the current tab is fully in
 * view, with `margin` px of room to the edge (the faded edge must not cover it). Pure: the strip
 * component measures, this decides. Returns the unchanged position when the tab is already visible.
 */
export interface StripBox {
  scrollLeft: number;
  clientWidth: number;
}

export interface TabBox {
  /** Left edge of the tab relative to the strip's scroll origin. */
  offsetLeft: number;
  offsetWidth: number;
}

export const REVEAL_MARGIN = 32;

export function scrollLeftToReveal(
  strip: StripBox,
  tab: TabBox,
  margin: number = REVEAL_MARGIN,
): number {
  const viewStart = strip.scrollLeft;
  const viewEnd = strip.scrollLeft + strip.clientWidth;
  const tabStart = tab.offsetLeft - margin;
  const tabEnd = tab.offsetLeft + tab.offsetWidth + margin;
  if (tabStart < viewStart) return Math.max(0, tabStart);
  if (tabEnd > viewEnd) return Math.max(0, tabEnd - strip.clientWidth);
  return strip.scrollLeft;
}
