// Issue #994 (N-04/N-19, D-994-10): the one name order of the web app - „Vorname Nachname“ - and the one sort
// order of the lists - last name, then first name, German collation.
import { describe, expect, it } from "vitest";

import { comparePersonsByLastName, personName, personNameWithNumber } from "../person-name";

describe("personName", () => {
  it("writes first name first", () => {
    expect(personName({ firstName: "Anna", lastName: "Muster" })).toBe("Anna Muster");
  });

  it("trims surrounding spaces and drops an empty first name", () => {
    expect(personName({ firstName: " Anna ", lastName: " Muster " })).toBe("Anna Muster");
    expect(personName({ firstName: "", lastName: "Muster" })).toBe("Muster");
    expect(personName({ firstName: "  ", lastName: "Muster" })).toBe("Muster");
  });

  it("reads an anonymised person as stored", () => {
    expect(personName({ firstName: "Gelöscht", lastName: "GELÖSCHT-ab12" })).toBe(
      "Gelöscht GELÖSCHT-ab12",
    );
  });
});

describe("personNameWithNumber", () => {
  it("appends the number after „· Nr. “", () => {
    expect(
      personNameWithNumber({ firstName: "Anna", lastName: "Muster", employeeNumber: "5" }),
    ).toBe("Anna Muster · Nr. 5");
  });

  it("leaves the suffix out for a missing, empty or blank number", () => {
    for (const employeeNumber of [undefined, null, "", "   "]) {
      expect(personNameWithNumber({ firstName: "Anna", lastName: "Muster", employeeNumber })).toBe(
        "Anna Muster",
      );
    }
  });
});

describe("comparePersonsByLastName", () => {
  it("sorts by last name, then first name, with German collation", () => {
    const people = [
      { firstName: "Zoe", lastName: "Önal" },
      { firstName: "Tom", lastName: "Muster" },
      { firstName: "Anna", lastName: "Muster" },
      { firstName: "Ali", lastName: "Zeh" },
    ];
    expect([...people].sort(comparePersonsByLastName).map(personName)).toEqual([
      "Anna Muster",
      "Tom Muster",
      "Zoe Önal",
      "Ali Zeh",
    ]);
  });

  it("puts an umlaut next to its base letter, not behind Z", () => {
    const people = [
      { firstName: "A", lastName: "Zeh" },
      { firstName: "B", lastName: "Äpfel" },
      { firstName: "C", lastName: "Adam" },
    ];
    expect([...people].sort(comparePersonsByLastName).map((p) => p.lastName)).toEqual([
      "Adam",
      "Äpfel",
      "Zeh",
    ]);
  });
});
