/**
 * Issue #1028 - the pure paging arithmetic of the shared list block (`Pager`, `ListWidget`,
 * `DataTable`). Pages are one-based; a page that does not exist is clamped, never an error.
 */

/** How many pages hold `total` rows at `size` per page (at least one, so an empty list has page 1). */
export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, size)));
}

/** A page inside 1..pageCount; anything that is not a finite number reads page 1. */
export function clampPage(page: number, total: number, size: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.trunc(page)), pageCount(total, size));
}

/** The rows of one page (a new array; an out-of-range page is empty). */
export function pageSlice<T>(rows: readonly T[], page: number, size: number): T[] {
  const start = (Math.max(1, page) - 1) * size;
  return rows.slice(start, start + size);
}

/** The page that holds a zero-based row index (a deep link to a row pages to it). */
export function pageOfIndex(index: number, size: number): number {
  if (!Number.isFinite(index) || index < 0) return 1;
  return Math.floor(index / Math.max(1, size)) + 1;
}

/** „1–5 von 44“; an empty list reads „0 von 0“, never „1–0“. */
export function rangeLabel(page: number, size: number, total: number): string {
  if (total <= 0) return "0 von 0";
  const start = (Math.max(1, page) - 1) * size + 1;
  const end = Math.min(page * size, total);
  return `${start}–${end} von ${total}`;
}
