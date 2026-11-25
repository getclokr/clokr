// Issue #1069 (Task 6) - the booking summary the toast after saving a Betriebsurlaub shows. The API answers
// counts only; the text must say exactly what happened, name no closed-month number (a rebook can count a
// (person, month) twice) and never read „Niemand ist betroffen“ for an empty-count answer of an unchanged period
// (that case is the page's decision and is pinned in admin-shutdown-detail-854).
import { describe, expect, it } from "vitest";

import {
  BOOKING_TOAST_MS,
  bookingSummaryText,
  bookingToast,
  type ShutdownBooking,
} from "../betriebsurlaub";

const NONE: ShutdownBooking = {
  persons: 0,
  absencesWritten: 0,
  vacationApproved: 0,
  vacationPending: 0,
  paidReleaseOnly: 0,
  partlyPaidRelease: 0,
  outsideCreateReach: 0,
  skippedClosedMonths: 0,
  existingLeavePersons: 0,
  refused: {},
  reversedRequests: 0,
  reversedAbsences: 0,
};
const LEAD = "Betriebsurlaub angelegt.";
const sum = (patch: Partial<ShutdownBooking>) => bookingSummaryText({ ...NONE, ...patch }, LEAD);

describe("bookingSummaryText", () => {
  it("says nobody is affected when nobody is", () => {
    expect(sum({})).toBe("Betriebsurlaub angelegt. Niemand ist betroffen.");
  });

  it("names approved and waiting requests, singular and plural", () => {
    expect(sum({ persons: 10, vacationApproved: 10 })).toBe(
      "Betriebsurlaub angelegt. 10 Urlaubsanträge genehmigt und vom Urlaubskonto abgezogen.",
    );
    expect(sum({ persons: 2, vacationApproved: 1, vacationPending: 1 })).toBe(
      "Betriebsurlaub angelegt. 1 Urlaubsantrag genehmigt und vom Urlaubskonto abgezogen. 1 Urlaubsantrag wartet unter Aufgaben auf Genehmigung.",
    );
    expect(sum({ persons: 3, vacationApproved: 1, vacationPending: 2 })).toContain(
      "2 Urlaubsanträge warten unter Aufgaben auf Genehmigung.",
    );
  });

  it("a shutdown without deduction is paid release for everyone", () => {
    expect(sum({ persons: 5, paidReleaseOnly: 5 })).toBe(
      "Betriebsurlaub angelegt. Alle Tage gelten als bezahlte Freistellung.",
    );
  });

  it("names persons with too little Resturlaub and persons with paid release only", () => {
    const text = sum({
      persons: 12,
      vacationApproved: 9,
      paidReleaseOnly: 1,
      partlyPaidRelease: 2,
    });
    expect(text).toContain("Für 1 Person gelten alle Tage als bezahlte Freistellung.");
    expect(text).toContain(
      "2 Personen haben zu wenig Resturlaub, die fehlenden Tage gelten als bezahlte Freistellung.",
    );
    expect(sum({ persons: 2, partlyPaidRelease: 1 })).toContain("1 Person hat zu wenig Resturlaub");
  });

  it("names reversals, existing leave and refusals, and never a closed-month number", () => {
    const text = sum({
      persons: 4,
      reversedRequests: 3,
      existingLeavePersons: 2,
      skippedClosedMonths: 7,
      outsideCreateReach: 1,
      refused: { BS_ONLY: 1, APPROVAL_SELF: 2 },
    });
    expect(text).toContain("3 Urlaubsanträge storniert, der Urlaub ist zurückgebucht.");
    expect(text).toContain(
      "Bei 2 Personen stehen in dieser Zeit schon Anträge oder gearbeitete Tage",
    );
    expect(text).toContain("Abgeschlossene Monate bleiben unverändert.");
    expect(text).not.toContain("7");
    expect(text).toContain("außerhalb deiner Zuständigkeit");
    expect(text).toContain("Nicht alle Urlaubsanträge konnten gebucht werden");
  });

  it("an approval refusal alone is no booking refusal (it is already a waiting request)", () => {
    expect(sum({ persons: 1, vacationPending: 1, refused: { APPROVAL_SELF: 1 } })).not.toContain(
      "konnten gebucht werden",
    );
  });

  it("uses du-form and no forbidden vocabulary", () => {
    const text = sum({ persons: 3, vacationPending: 1, outsideCreateReach: 1 });
    expect(text).not.toMatch(/\b(Sie|Ihnen|Ihr|Tenant|Mandant|Inbox)\b/);
  });
});

describe("bookingToast", () => {
  it("is the plain lead without a booking answer and a long summary with one", () => {
    expect(bookingToast({}, LEAD)).toEqual({ message: LEAD, duration: undefined });
    const toast = bookingToast({ booking: { ...NONE, persons: 1, paidReleaseOnly: 1 } }, LEAD);
    expect(toast.message).toContain("bezahlte Freistellung");
    expect(toast.duration).toBe(BOOKING_TOAST_MS);
  });
});
