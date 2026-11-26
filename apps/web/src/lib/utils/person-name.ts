// Issue #994 (N-04/N-19, D-994-10) - the one name order of the web app. A person's name is always written
// „Vorname Nachname“; a list or a picker still SORTS by last name, then first name (German collation), because
// that is how people look a name up. Pure: no store, no request.
//
// Out of scope on purpose: the operator console (another audience) and the payroll files (Monatsexport, DATEV),
// which the API builds as a sorted list for the payroll office.

export interface PersonNameParts {
  firstName: string;
  lastName: string;
}

export interface PersonNameWithNumberParts extends PersonNameParts {
  /** Optional: the list endpoint serves it; a row without one gets no suffix. */
  employeeNumber?: string | null;
}

// One collator for the module: constructing it per comparison is the slow part of a sort.
const COLLATOR = new Intl.Collator("de");

/** „Anna Muster“ (an empty first name leaves the last name alone). */
export function personName(person: PersonNameParts): string {
  return [person.firstName, person.lastName]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(" ");
}

/** „Anna Muster · Nr. 5“ (no number: „Anna Muster“); the separator of D-992-07. */
export function personNameWithNumber(person: PersonNameWithNumberParts): string {
  const number = person.employeeNumber?.trim();
  return number ? `${personName(person)} · Nr. ${number}` : personName(person);
}

/** Sort order of lists and pickers: last name, then first name, German collation. */
export function comparePersonsByLastName(a: PersonNameParts, b: PersonNameParts): number {
  return COLLATOR.compare(a.lastName, b.lastName) || COLLATOR.compare(a.firstName, b.firstName);
}
