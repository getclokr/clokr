/**
 * Issue #992 — the ONE place a list of words is joined the German way: „A“, „A und B“, „A, B und C“.
 * Used where a text names the pages or tabs a reader sees (hub rows, hints), so it never promises more.
 */
export function joinGerman(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} und ${items[items.length - 1]}`;
}
