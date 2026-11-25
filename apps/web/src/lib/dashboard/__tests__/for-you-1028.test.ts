// Issue #1028 - the pure derivation of the rows of „Für dich“ (Mein Tag): ordering and texts. Every
// missing day and every day with an entry to fix is one row, newest first; break rows, the karenz row
// and the pending-requests row keep their texts and links.
import { describe, expect, it } from "vitest";
import { forYouItems } from "../for-you";
import { endEntryHref } from "$lib/time-entries/open-earlier-entry";

const dayShort = (iso: string) => `D${iso}`;
const NO_KARENZ = { count: 0, earliestDay: null, targetRequestId: null, label: "" };

const base = {
  breakDays: [] as string[],
  openItems: {
    missingDays: [] as string[],
    pendingRequests: 0,
    invalidEntries: 0,
  } as Parameters<typeof forYouItems>[0]["openItems"],
  karenz: NO_KARENZ,
  dayShort,
};

describe("forYouItems (Issue #1028)", () => {
  it("is empty when nothing is open", () => {
    expect(forYouItems(base)).toEqual([]);
    expect(forYouItems({ ...base, openItems: null })).toEqual([]);
  });

  it("lists the break days (oldest first, the first with the test id), then the missing days newest first", () => {
    const rows = forYouItems({
      ...base,
      breakDays: ["2026-11-10", "2026-11-04"],
      openItems: {
        missingDays: ["2026-11-05"],
        missingDaysInMonth: ["2026-11-05", "2026-11-12", "2026-11-09"],
        pendingRequests: 0,
        invalidEntries: 0,
      },
    });
    expect(rows.map((r) => r.key)).toEqual([
      "break-2026-11-04",
      "break-2026-11-10",
      "miss-2026-11-12",
      "miss-2026-11-09",
      "miss-2026-11-05",
    ]);
    expect(rows[0].testId).toBe("dashboard-break-nudge");
    expect(rows[1].testId).toBeUndefined();
    expect(rows[0].title).toBe("D2026-11-04 ohne Pause");
    expect(rows[0].href).toBe("/time-entries?view=list&date=2026-11-04");
  });

  it("words a missing day with its texts and link", () => {
    const [row] = forYouItems({
      ...base,
      openItems: { missingDays: ["2026-11-12"], pendingRequests: 0, invalidEntries: 0 },
    });
    expect(row).toEqual({
      key: "miss-2026-11-12",
      title: "D2026-11-12 ohne Zeiteintrag",
      subtitle: "An diesem Arbeitstag fehlt deine Zeit.",
      chip: "Fehlt",
      tone: "bad",
      href: "/ich/zeiten?view=list&date=2026-11-12",
      action: "Nachtragen",
    });
  });

  it("every invalid-entry day is a row, newest first, after the missing days", () => {
    const rows = forYouItems({
      ...base,
      openItems: {
        missingDays: ["2026-11-03"],
        pendingRequests: 0,
        invalidEntries: 3,
        invalidEntryDays: [
          { date: "2026-11-02", entryId: "a", open: false },
          { date: "2026-11-06", entryId: "b", open: true },
          { date: "2026-11-04", entryId: "c", open: false },
        ],
      },
    });
    expect(rows.map((r) => r.key)).toEqual([
      "miss-2026-11-03",
      "invalid-2026-11-06",
      "invalid-2026-11-04",
      "invalid-2026-11-02",
    ]);
    expect(rows[1].href).toBe(endEntryHref({ id: "b", day: "2026-11-06" }));
  });

  it("keeps the karenz and the pending rows at the end with their texts and links", () => {
    const rows = forYouItems({
      ...base,
      openItems: { missingDays: ["2026-11-03"], pendingRequests: 2, invalidEntries: 0 },
      karenz: {
        count: 2,
        earliestDay: "2026-11-01",
        targetRequestId: "lr1",
        label: "2 Tage ohne Attest",
      },
    });
    expect(rows.map((r) => r.key)).toEqual(["miss-2026-11-03", "karenz", "pending"]);
    expect(rows[1]).toMatchObject({
      title: "2 Tage ohne Attest",
      href: "/leave?request=lr1",
      testId: "dashboard-karenz-nudge",
      chip: "Info",
    });
    expect(rows[2]).toMatchObject({
      title: "2 Anträge warten",
      href: "/ich/abwesenheiten?tab=antraege",
      action: "Ansehen",
    });
    const one = forYouItems({
      ...base,
      openItems: { missingDays: [], pendingRequests: 1, invalidEntries: 0 },
    });
    expect(one[0].title).toBe("Dein Antrag wartet");
  });

  it("never emits a summary row, however many days there are", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      `2026-10-${String(i + 1).padStart(2, "0")}`.slice(0, 10),
    );
    const rows = forYouItems({
      ...base,
      openItems: { missingDays: many, pendingRequests: 0, invalidEntries: 0 },
    });
    expect(rows.length).toBe(new Set(many).size);
    expect(rows.every((r) => !/weitere/.test(r.title))).toBe(true);
  });
});
