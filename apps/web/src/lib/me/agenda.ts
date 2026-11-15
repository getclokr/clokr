// Issue #597 (Phase 851, prototype „Ich › Dienstplan“): the next 14 days as one stream - the own shifts
// (GET /shifts/range, with the shift's own salon), effective leave (the EFFECTIVE_LEAVE_STATUSES mirror)
// and public holidays (GET /holidays of the Stammsalon). Pure: it groups and labels, no rule of its own.
//
// Issue #589 (AC-589-5, AC-589-6): a shift's salon is named from the caller's salon context
// (`salonNames`); „anderer Salon“ (subtitle and chip) only for an id outside it. A day without a shift,
// leave or holiday reads „Frei“ only when the contract does not put the person to work: a FIXED_SCHEDULE
// or FLEXTIME contract day is „Noch nicht geplant“ (`contractFixesWorkDays`, D-589-10); for SHIFT_BASED,
// MONTHLY_HOURS, an unknown contract or a day before the loaded contract starts the ISO week decides - no
// own shift in the week yet means the plan is still missing, else „Frei“.
import { isEffectiveLeaveStatus } from "$lib/leave/effective-leave-statuses";
import { contractFixesWorkDays, isWorkDay, type WorkScheduleLike } from "$lib/utils/work-schedule";

export interface AgendaShift {
  date: string;
  startTime: string;
  endTime: string;
  durationMinNetto: number;
  salonId?: string;
}

export interface AgendaLeave {
  startDate: string;
  endDate: string;
  status: string;
  halfDay?: boolean;
  label: string;
}

export interface AgendaHoliday {
  date: string;
  name: string;
}

export type AgendaKind = "shift" | "leave" | "holiday" | "free" | "unplanned";

export interface AgendaDay {
  date: string;
  weekday: string;
  dayLabel: string;
  isToday: boolean;
  kind: AgendaKind;
  shifts: AgendaShift[];
  title: string;
  subtitle: string;
  /** Planned net minutes of the day's shifts (for the chip). */
  netMinutes: number;
  /** A shift in a salon outside the caller's salon context (named „anderer Salon“). */
  otherSalon: boolean;
}

export interface AgendaWeek {
  label: string;
  days: AgendaDay[];
}

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ISO week number of a local date. */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Monday of the local ISO week of a date, as a local calendar day key. */
function weekKey(d: Date): string {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return isoDay(monday);
}

/** The own contract as the loaded employee row carries it; `validFrom` is an instant (ISO string). */
export type AgendaContract = WorkScheduleLike & { validFrom: string };

export function buildAgenda(
  start: Date,
  days: number,
  input: {
    shifts: readonly AgendaShift[];
    leave: readonly AgendaLeave[];
    holidays: readonly AgendaHoliday[];
    /** Names of the salons of the caller's salon context, by id. */
    salonNames: ReadonlyMap<string, string>;
    /** The own contract (newest row), or null when it is unknown. */
    contract: AgendaContract | null;
  },
): AgendaWeek[] {
  const today = isoDay(start);
  const salonName = (id: string | undefined): string =>
    id ? (input.salonNames.get(id) ?? "anderer Salon") : "";
  // Weeks (Monday keys) that hold at least one own shift — the fetched shifts cover whole ISO weeks, so
  // an earlier day of the current week counts even when it lies before the window.
  const weeksWithShift = new Set(
    input.shifts.map((s) => {
      const [y, m, day] = s.date.slice(0, 10).split("-").map(Number);
      return weekKey(new Date(y, m - 1, day));
    }),
  );
  // validFrom is an instant: compare by the browser-local calendar day, never slice(0, 10).
  const contract = input.contract;
  const contractStart = contract ? isoDay(new Date(contract.validFrom)) : null;
  const thisWeek = isoWeek(start);
  const weeks: AgendaWeek[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const date = isoDay(d);
    const shifts = input.shifts.filter((s) => s.date === date);
    const leave = input.leave.find(
      (l) =>
        isEffectiveLeaveStatus(l.status) &&
        l.startDate.slice(0, 10) <= date &&
        l.endDate.slice(0, 10) >= date,
    );
    const holiday = input.holidays.find((h) => h.date.slice(0, 10) === date);
    let kind: AgendaKind = "free";
    let title = "Frei";
    let subtitle = "";
    // Issue #589 (D-589-10): the default of a day with no shift, leave or holiday.
    if (
      contract &&
      contractStart !== null &&
      date >= contractStart &&
      contractFixesWorkDays(contract)
    ) {
      if (isWorkDay(contract, d)) {
        kind = "unplanned";
        title = "Noch nicht geplant";
        subtitle = "Arbeitstag laut Vertrag";
      }
    } else if (!weeksWithShift.has(weekKey(d))) {
      kind = "unplanned";
      title = "Noch nicht geplant";
      subtitle = "Der Plan für diese Woche fehlt noch";
    }
    if (shifts.length > 0) {
      kind = "shift";
      title = shifts.map((s) => `${s.startTime} – ${s.endTime}`).join(" · ");
      subtitle = [...new Set(shifts.map((s) => salonName(s.salonId)))].join(" · ");
    }
    if (leave) {
      kind = shifts.length > 0 ? "shift" : "leave";
      if (shifts.length === 0) {
        title = leave.halfDay ? `${leave.label} (halber Tag)` : leave.label;
        subtitle = "";
      } else subtitle = `${subtitle} · ${leave.label}`;
    }
    if (holiday && shifts.length === 0) {
      kind = "holiday";
      title = holiday.name;
      subtitle = "Feiertag";
    }
    const week = isoWeek(d);
    const label =
      week === thisWeek
        ? `Diese Woche · KW ${week}`
        : week === thisWeek + 1 || (thisWeek >= 52 && week === 1)
          ? `Nächste Woche · KW ${week}`
          : `KW ${week}`;
    let bucket = weeks[weeks.length - 1];
    if (!bucket || bucket.label !== label) {
      bucket = { label, days: [] };
      weeks.push(bucket);
    }
    bucket.days.push({
      date,
      weekday: WD[d.getDay()],
      dayLabel: `${d.getDate()}.${d.getMonth() + 1}.`,
      isToday: date === today,
      kind,
      shifts,
      title,
      subtitle,
      netMinutes: shifts.reduce((sum, s) => sum + s.durationMinNetto, 0),
      otherSalon: shifts.some((s) => s.salonId && !input.salonNames.has(s.salonId)),
    });
  }
  return weeks;
}
