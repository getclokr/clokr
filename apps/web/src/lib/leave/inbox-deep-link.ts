// Issue #840 (D-840-05, T-840-30) - the receiver of the inbox deep links.
//
// `/inbox?request=<id>[&year=<YYYY>]` (a leave notification, the Anträge tab) opens the shared review
// dialog; `/inbox?section9=<id>` scrolls to one § 9 case. URL parameters are untrusted text: ids are
// reduced to a lowercase uuid, the year to a bounded 4-digit number, everything else becomes `null`.
// Reading a link has no effect of its own - the inbox only opens a row the API already listed for
// the caller (T-840-27).
import { normalizeEmployeeIdParam } from "$lib/breaks/deep-link";

export interface InboxDeepLink {
  /** Lowercase uuid of the leave request to open, or `null`. */
  requestId: string | null;
  /** Year whose list holds the request, or `null` (the current year's list is the default). */
  year: number | null;
  /** Lowercase uuid of the § 9 case to scroll to, or `null`. */
  section9Id: string | null;
}

/** How far from the current year a deep link may point (a request can start next year). */
const YEAR_WINDOW = 5;

function parseYear(raw: string | null, currentYear: number): number | null {
  if (raw === null || !/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return Math.abs(year - currentYear) <= YEAR_WINDOW ? year : null;
}

/** Reads the three inbox deep-link parameters. Pure; never throws. */
export function parseInboxDeepLink(
  params: Pick<URLSearchParams, "get">,
  currentYear: number,
): InboxDeepLink {
  try {
    return {
      requestId: normalizeEmployeeIdParam(params.get("request")),
      year: parseYear(params.get("year"), currentYear),
      section9Id: normalizeEmployeeIdParam(params.get("section9")),
    };
  } catch {
    return { requestId: null, year: null, section9Id: null };
  }
}

/**
 * The sender side of the deep link: `/team/aufgaben?request=<id>&year=<YYYY of the start day>`.
 * Issue #992 (N-07, owner decision 25.11.2026): a request is decided in Aufgaben only, every other
 * place links there. The year selects the list that holds the request (a request can start next
 * year). Returns `null` for an id that is not a uuid or a start day that is not an ISO date, so a
 * caller renders no link instead of a broken one. Writes only a lowercase uuid and 4 digits.
 */
export function inboxRequestHref(id: string, startDate: string): string | null {
  const requestId = normalizeEmployeeIdParam(id);
  const year = /^(\d{4})-\d{2}-\d{2}/.exec(startDate)?.[1];
  if (requestId === null || year === undefined) return null;
  return `/team/aufgaben?request=${requestId}&year=${year}`;
}
