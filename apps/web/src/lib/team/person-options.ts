// Issue #853 (D-853-10) - the options of the person picker on Team › Zeiten. Pure: no store, no
// request. The Personalnummer sits in the label because the Combobox filters through the one
// search normaliser over the label, so a leader finds a person by name or by number.
// Issue #994 (D-994-10): the label reads „Vorname Nachname · Nr. 5“ through the one name helper (it replaces
// the „Nachname, Vorname“ format of D-853-10); the picker is still sorted by last name, first name, id.

import { comparePersonsByLastName, personNameWithNumber } from "$lib/utils/person-name";

export interface PersonOptionSource {
  id: string;
  firstName: string;
  lastName: string;
  /** Optional: the list endpoint serves it; a row without one gets no suffix. */
  employeeNumber?: string | null;
}

export interface PersonOption {
  value: string;
  label: string;
}

const COLLATOR = new Intl.Collator("de");

/** „Vorname Nachname · Nr. 123“ (no number: „Vorname Nachname“). */
export function personOptionLabel(person: PersonOptionSource): string {
  return personNameWithNumber(person);
}

/** The picker items, sorted by last name, first name and id (German collation). */
export function personOptions(employees: readonly PersonOptionSource[]): PersonOption[] {
  return [...employees]
    .sort((a, b) => comparePersonsByLastName(a, b) || COLLATOR.compare(a.id, b.id))
    .map((person) => ({ value: person.id, label: personOptionLabel(person) }));
}
