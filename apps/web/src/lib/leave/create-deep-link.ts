// Issue #587 (D-587-4) — the receiver of the „Abwesenheit erfassen“ link on /team/leave.
//
// URL parameters are untrusted text: they are validated with the existing
// `normalizeEmployeeIdParam` / `normalizeDateParam`. Opening the existing „Neue Abwesenheit“
// dialog is the only effect; saving stays the user's explicit action in that dialog, and the
// person is applied only when it is in the page's own (salon-filtered) list.
import { normalizeDateParam, normalizeEmployeeIdParam } from "$lib/breaks/deep-link";

export interface LeaveCreateDeepLink {
  /** Lowercase uuid, or `null` — the picker then stays empty. */
  employeeId: string | null;
  /** A real calendar day, or `null` — the dialog then keeps its default day. */
  date: string | null;
}

/**
 * Reads `?create=1&employeeId=<id>&date=<day>`. Returns `null` unless `create` is exactly `1`;
 * otherwise each unusable value is dropped on its own, never the whole link.
 */
export function parseLeaveCreateDeepLink(
  params: Pick<URLSearchParams, "get">,
): LeaveCreateDeepLink | null {
  if (params.get("create") !== "1") return null;
  return {
    employeeId: normalizeEmployeeIdParam(params.get("employeeId")),
    date: normalizeDateParam(params.get("date")),
  };
}

/**
 * Issue #992: the address after the create link was applied. `create`, `employeeId` and `date` belong
 * only to the create link on this page, so they are dropped once the dialog is open — a reload or
 * the back button never opens the dialog a second time. Every other parameter stays.
 */
export function withoutLeaveCreateDeepLink(url: URL): URL {
  const next = new URL(url.href);
  for (const key of ["create", "employeeId", "date"]) next.searchParams.delete(key);
  return next;
}
