// Issue #949 - the ONE place that words why a listed person's Stammsalon is not one of the caller's
// salons. Person lists (Team › Personen, Verwalten › Personen, the Team › Abwesenheiten timeline)
// follow the master-data rule of Phase 91b D-12 (`resolvePersonScopedEmployeeIds`): a scoped reader
// sees the persons homed in their salons AND the persons with an active Einsatz (DEPLOYMENT) there.
// Such a Springer's Stammsalon lies outside the reader's salon list, so without this mark the row
// read as "no Stammsalon". Presentation only: it never decides who is listed and reads no permission.

/** `NONE`: no Stammsalon today. `ELSEWHERE`: a Stammsalon the caller's salon list does not name. */
export type HomeSalonMarkKind = "NONE" | "ELSEWHERE";

export interface HomeSalonMark {
  kind: HomeSalonMarkKind;
  /** The chip text. */
  label: string;
  /** The text of a narrow cell (the timeline's name column); the hint carries the rest. */
  shortLabel: string;
  /** The longer explanation (tooltip). */
  hint: string;
}

const MARKS: Record<HomeSalonMarkKind, HomeSalonMark> = {
  NONE: {
    kind: "NONE",
    label: "Ohne Stammsalon",
    shortLabel: "Ohne Salon",
    hint: "Diese Person hat heute keinen Stammsalon.",
  },
  ELSEWHERE: {
    kind: "ELSEWHERE",
    label: "Anderer Stammsalon",
    shortLabel: "Einsatz",
    hint: "Der Stammsalon liegt in einem Salon, den du nicht siehst - die Person ist in deinem Salon im Einsatz oder dir direkt zugeordnet.",
  },
};

/**
 * The mark of one person, or null when nothing needs saying. `homeSalonId` is the server's
 * Stammsalon of today (`GET /employees?include=directory`): `undefined` means the field was not
 * loaded and never yields a mark. `marksApply` is `homeSalonMarksApply()` of the salon context: a
 * tenant with a single salon gets no mark at all - there the Stammsalon decides nothing a reader
 * could miss.
 */
export function homeSalonMark(
  homeSalonId: string | null | undefined,
  viewSalonIds: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  marksApply: boolean,
): HomeSalonMark | null {
  if (!marksApply || homeSalonId === undefined) return null;
  if (homeSalonId === null || homeSalonId === "") return MARKS.NONE;
  return viewSalonIds.has(homeSalonId) ? null : MARKS.ELSEWHERE;
}

/** The value of the Stammsalon filter that lists the persons without one (never a salon id). */
export const NO_HOME_SALON_FILTER = "ohne";
