// Issue #992 (N-05, D-992-10) - the address of Team › Zeiten: the chosen person and the selected day live in
// the address, so a link to „die Person, November“ can be passed on. The page already reads `employeeId` and
// `date` on arrival; these pure helpers write them back. A value the receivers (`normalizeEmployeeIdParam`,
// `normalizeDateParam`) would reject is never written. `eintragen=1` (Heute im Salon › „Zeit eintragen“,
// D-992-12) is read once on arrival and never written back.
import { normalizeDateParam, normalizeEmployeeIdParam } from "$lib/breaks/deep-link";

/** What the helpers read of the address: a `URLSearchParams` or SvelteKit's read-only twin of it. */
export type SearchParamsLike = Pick<URLSearchParams, "get" | "toString">;

export interface TeamZeitenAddressState {
  mode: "person" | "salon";
  employeeId: string | null;
  date: string | null;
}

/**
 * The next query of Team › Zeiten: person mode sets `employeeId` and `date` (when valid, else removes them)
 * and removes `mode`; salon mode sets `mode=salon` and removes `employeeId`. `view` and every other key of
 * `current` stay; `eintragen` is always dropped. Returns a new object, `current` is not changed.
 */
export function teamZeitenSearch(
  current: SearchParamsLike,
  state: TeamZeitenAddressState,
): URLSearchParams {
  const next = new URLSearchParams(current.toString());
  next.delete("eintragen");
  if (state.mode === "salon") {
    next.set("mode", "salon");
    next.delete("employeeId");
    return next;
  }
  next.delete("mode");
  const id = normalizeEmployeeIdParam(state.employeeId);
  if (id === null) next.delete("employeeId");
  else next.set("employeeId", id);
  const day = normalizeDateParam(state.date);
  if (day === null) next.delete("date");
  else next.set("date", day);
  return next;
}

/** True only for `eintragen=1`: the add dialog opens once a person is chosen. */
export function addOnArrival(params: SearchParamsLike): boolean {
  return params.get("eintragen") === "1";
}
