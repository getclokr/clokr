/**
 * Register amendment DAILY_MAX_TEXT_HM (Issue #954) of the frozen #80 equivalence fixture.
 *
 * `legacy-day-warnings-pre80.ts` is never edited. Its MAX_DAILY_EXCEEDED text prints the day total
 * as decimal hours; since #954 the kernel prints H:MM, rounded up to whole minutes. This module
 * applies exactly that one change to a frozen result: the day total is recomputed the same way the
 * frozen function computes it (Σ working minutes of the slots + Berufsschule minutes), and every
 * other warning, key and key order stays as the fixture produced it. Test-local copy of the text,
 * independent of the kernel.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { entryDurations } from "../../entry-durations";
import type { LegacyDaySlot, LegacyDayWarning } from "./legacy-day-warnings-pre80";

interface TextAmendment {
  id: string;
  issue: number;
  reason: string;
}
const REGISTER = (
  JSON.parse(readFileSync(join(__dirname, "day-break-equivalence-80-amendments.json"), "utf8")) as {
    amendments: TextAmendment[];
  }
).amendments;
const AMENDMENT = REGISTER.find((a) => a.id === "DAILY_MAX_TEXT_HM");
if (AMENDMENT === undefined || AMENDMENT.issue !== 954 || AMENDMENT.reason.length < 80) {
  throw new Error("equivalence amendment register: DAILY_MAX_TEXT_HM missing or unexplained");
}

function hm(wholeMinutes: number): string {
  return `${Math.floor(wholeMinutes / 60)}:${String(wholeMinutes % 60).padStart(2, "0")}`;
}

/** The frozen warnings of one day with the #954 text of the daily maximum. */
export function withDailyMaxTextAmendment(
  warnings: LegacyDayWarning[],
  daySlots: LegacyDaySlot[],
  bsMinutesToday: number,
): LegacyDayWarning[] {
  return warnings.map((w) => {
    if (w.code !== "MAX_DAILY_EXCEEDED") return w;
    let netWorkedMin = 0;
    for (const slot of daySlots) netWorkedMin += entryDurations(slot).workingMinutes;
    const total = Math.ceil(netWorkedMin + bsMinutesToday - 1e-9);
    return {
      ...w,
      message: `§ 3 ArbZG: Tägliche Höchstarbeitszeit von 10 Stunden überschritten. Erfasst: ${hm(total)} Std.`,
    };
  });
}
