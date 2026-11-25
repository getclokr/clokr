/**
 * Issue #1028 - the web half of the list register `packages/types/list-preferences.json`.
 *
 * The register is the ONE place that names list ids, kinds (widget | table), page sizes and filter
 * allow-lists; the API validates `PUT /me/preferences` (`lists`) against the same file. A stored value
 * is never used as it is: `resolveListPreference()` falls back to the list's default for anything that is
 * missing, unknown or invalid, so a stale or hand-edited value can never reach a widget (T-1028-06).
 * Values are control values only, never markup. Pure module: no store, no `$app`.
 */
import register from "@clokr/types/list-preferences.json";

export type ListKind = "widget" | "table";

interface ListDefinition {
  kind: ListKind;
  /** The list's own default size, one of its kind's sizes; absent = the kind's default. */
  defaultPageSize?: number;
  /** Allow-list of filter values; absent = the list has none, or its values are codes (see below). */
  filters?: readonly string[];
  defaultFilter?: string;
}

const data = register as {
  pageSizes: Record<ListKind, readonly number[]>;
  defaults: Record<ListKind, number>;
  lists: Record<string, ListDefinition>;
};

/** Every registered list id. */
export type ListId = keyof typeof register.lists;

/** What is stored per list and person: both fields are optional, an absent one reads the default. */
export interface ListPreference {
  pageSize?: number;
  filter?: string | null;
}

/** The resolved, always valid choice of one list. `filter` is null for a list that has none. */
export interface ResolvedListPreference {
  pageSize: number;
  filter: string | null;
}

/** A filter value that is a code (a leave type code) for a list without an allow-list. */
const CODE_FILTER = /^[A-Za-z0-9_-]{1,40}$/;

export const LIST_IDS = Object.keys(data.lists) as ListId[];

/** True for a registered id (own keys only, never something of `Object.prototype`). */
export function isListId(value: unknown): value is ListId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(data.lists, value);
}

function definitionOf(id: ListId): ListDefinition {
  return data.lists[id];
}

export function kindOf(id: ListId): ListKind {
  return definitionOf(id).kind;
}

/** The page sizes the list offers (its kind's sizes). */
export function pageSizesOf(id: ListId): readonly number[] {
  return data.pageSizes[kindOf(id)];
}

export function defaultPageSizeOf(id: ListId): number {
  const def = definitionOf(id);
  const own = def.defaultPageSize;
  return own !== undefined && data.pageSizes[def.kind].includes(own)
    ? own
    : data.defaults[def.kind];
}

/** The filter allow-list of a list, or undefined when it names none. */
export function filtersOf(id: ListId): readonly string[] | undefined {
  return definitionOf(id).filters;
}

export function defaultFilterOf(id: ListId): string | undefined {
  return definitionOf(id).defaultFilter;
}

/** The page sizes of a kind (a DataTable without a `listId` offers the table sizes). */
export function pageSizesOfKind(kind: ListKind): readonly number[] {
  return data.pageSizes[kind];
}

export function defaultPageSizeOfKind(kind: ListKind): number {
  return data.defaults[kind];
}

function filterAllowed(id: ListId, value: unknown): value is string {
  if (typeof value !== "string") return false;
  const def = definitionOf(id);
  if (def.filters) return def.filters.includes(value);
  return def.defaultFilter !== undefined && CODE_FILTER.test(value);
}

/** The shown page size and filter: the stored value when valid, else the list's default. */
export function resolveListPreference(id: ListId, stored: unknown): ResolvedListPreference {
  const entry =
    typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
  const pageSize =
    typeof entry.pageSize === "number" && pageSizesOf(id).includes(entry.pageSize)
      ? entry.pageSize
      : defaultPageSizeOf(id);
  const filter = filterAllowed(id, entry.filter) ? entry.filter : (defaultFilterOf(id) ?? null);
  return { pageSize, filter };
}
