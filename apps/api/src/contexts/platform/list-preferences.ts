import { z } from "zod";
import register from "@clokr/types/list-preferences.json";

/**
 * Issue #1028 - the stored page size and filter of a list (`User.uiPreferences.lists`).
 *
 * The register of list ids is `packages/types/list-preferences.json`, the one place that names ids,
 * kinds, page sizes and filters; the web resolves against the same file. This module is the API half:
 * `listPreferencesInput` validates a PUT against the register (an unknown id, a size outside the kind's
 * sizes or a filter outside the list's allow-list is a 400) and `storedListPreferences()` reads the
 * stored object back and drops everything that no longer fits (a stale id after a register change, a
 * hand-edited value), so a bad stored value can never reach the web. Pure module: no Prisma, no clock.
 *
 * Why the bound holds (T-1028-01): ids come only from the register, sizes only from the kind's list,
 * a filter only from the allow-list (or, for a list whose filter values are codes such as the leave
 * type codes of „Demnächst abwesend“, from a short code pattern), at most 16 entries per PUT. The
 * stored object is therefore bounded by the register.
 */

type ListKind = "widget" | "table";

interface ListDefinition {
  kind: ListKind;
  filters?: readonly string[];
  defaultFilter?: string;
}

const data = register as {
  pageSizes: Record<ListKind, readonly number[]>;
  lists: Record<string, ListDefinition>;
};

/** A filter value that is a code (a leave type code), for a list that declares no allow-list. */
const CODE_FILTER = /^[A-Za-z0-9_-]{1,40}$/;

/** The most entries one PUT may carry. */
export const MAX_LIST_ENTRIES_PER_PUT = 16;

export interface StoredListPreference {
  pageSize?: number;
  filter?: string | null;
}

function definitionOf(id: string): ListDefinition | undefined {
  return Object.prototype.hasOwnProperty.call(data.lists, id) ? data.lists[id] : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sizeAllowed(def: ListDefinition, value: unknown): value is number {
  return typeof value === "number" && data.pageSizes[def.kind].includes(value);
}

function filterAllowed(def: ListDefinition, value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (def.filters) return def.filters.includes(value);
  // A list without an allow-list takes a code filter only when it has a filter at all (a default).
  return def.defaultFilter !== undefined && CODE_FILTER.test(value);
}

/**
 * The input of `PUT /me/preferences` for `lists`: a record of list id to `{ pageSize?, filter? }`.
 * An entry is replaced as a whole by the caller (the web always sends the complete entry).
 */
export const listPreferencesInput = z
  .record(z.string(), z.unknown())
  .superRefine((entries, ctx) => {
    const ids = Object.keys(entries);
    if (ids.length > MAX_LIST_ENTRIES_PER_PUT) {
      ctx.addIssue({ code: "custom", message: "Zu viele Listeneinstellungen auf einmal." });
      return;
    }
    for (const id of ids) {
      const def = definitionOf(id);
      const entry = entries[id];
      if (!def) {
        ctx.addIssue({ code: "custom", path: [id], message: "Unbekannte Liste." });
        continue;
      }
      if (!isPlainObject(entry)) {
        ctx.addIssue({ code: "custom", path: [id], message: "Ungültige Listeneinstellung." });
        continue;
      }
      if (entry.pageSize !== undefined && !sizeAllowed(def, entry.pageSize)) {
        ctx.addIssue({
          code: "custom",
          path: [id, "pageSize"],
          message: "Ungültige Anzahl pro Seite.",
        });
      }
      if (
        entry.filter !== undefined &&
        entry.filter !== null &&
        !filterAllowed(def, entry.filter)
      ) {
        ctx.addIssue({ code: "custom", path: [id, "filter"], message: "Ungültiger Filter." });
      }
    }
  })
  // Keep only the two known fields of a valid entry, so nothing else is ever stored.
  .transform((entries) => {
    const clean: Record<string, StoredListPreference> = {};
    for (const [id, raw] of Object.entries(entries)) {
      const entry = raw as Record<string, unknown>;
      const out: StoredListPreference = {};
      if (entry.pageSize !== undefined) out.pageSize = entry.pageSize as number;
      if (entry.filter !== undefined) out.filter = entry.filter as string | null;
      clean[id] = out;
    }
    return clean;
  });

/**
 * The stored `lists` value read back: only entries of a registered list whose fields are valid stay;
 * an invalid field is dropped from its entry, an entry that is not an object, or has no valid field left, is dropped whole.
 */
export function storedListPreferences(raw: unknown): Record<string, StoredListPreference> {
  const result: Record<string, StoredListPreference> = {};
  if (!isPlainObject(raw)) return result;
  for (const [id, entry] of Object.entries(raw)) {
    const def = definitionOf(id);
    if (!def || !isPlainObject(entry)) continue;
    const out: StoredListPreference = {};
    if (sizeAllowed(def, entry.pageSize)) out.pageSize = entry.pageSize;
    if (entry.filter === null) out.filter = null;
    else if (filterAllowed(def, entry.filter)) out.filter = entry.filter;
    // An entry with nothing valid left says nothing (the list's defaults apply), so it is dropped.
    if (Object.keys(out).length > 0) result[id] = out;
  }
  return result;
}
