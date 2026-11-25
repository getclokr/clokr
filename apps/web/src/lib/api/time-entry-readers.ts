import { api } from "$api/client";
import type { TimeEntryReadersResponse } from "@clokr/types";

/**
 * Issue #606: the roles that can read the caller's own time entries, as the server derives them
 * from the stored role assignments (categories only: role name, coverage, purposes).
 */
export function fetchTimeEntryReaders(): Promise<TimeEntryReadersResponse> {
  return api.get<TimeEntryReadersResponse>("/me/time-entry-readers");
}
