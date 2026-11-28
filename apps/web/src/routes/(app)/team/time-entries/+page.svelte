<script lang="ts">
  import { homeHref } from "$lib/nav/routes";
  import { pageLabel } from "$lib/nav/page-labels";
  import { leaveTypeColor, FALLBACK } from "$lib/leave/leave-colors"; // Issue #840 (D-840-12)
  import { calendarAbsenceLabel, OTHER_ABSENCE_LABEL } from "$lib/time-entries/absence-label"; // Issue #528
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import { page } from "$app/state";
  import { goto, replaceState } from "$app/navigation";
  import { api } from "$api/client";
  import { authStore } from "$stores/auth";
  import { tenantFeatures } from "$stores/tenant-features"; // Issue #1072
  import { dayAnchor, tenantDay } from "$lib/utils/tenant-day"; // Issue #1072
  import { teamEntryWriteError } from "$lib/team/entry-write-error"; // Issue #1020
  import { proposeBreakSlot } from "$lib/breaks/break-proposal"; // Issue #1020
  import { entryDay } from "$lib/time-entries/open-earlier-entry"; // Issue #1020
  import { mayOpenTeamPage } from "$lib/nav/team-nav";
  import { addOnArrival, teamZeitenSearch } from "$lib/team/zeiten-url"; // Issue #992
  import { hasPermission } from "$lib/permissions";
  import PageHead from "$lib/components/layout/PageHead.svelte";
  import InfoHint, { hintLabel } from "$components/ui/InfoHint.svelte"; // Issue #1058
  import MonthBar from "$components/ui/MonthBar.svelte";
  import PageTabs from "$components/ui/PageTabs.svelte"; // Issue #853 (D-853-10)
  import SegmentedControl from "$components/ui/SegmentedControl.svelte";
  import EmptyState from "$components/ui/EmptyState.svelte";
  import PersonPicker from "$lib/components/team/zeiten/PersonPicker.svelte";
  import { personOptions } from "$lib/team/person-options";
  import KpiStrip from "$components/ui/KpiStrip.svelte"; // Issue #853 (D-853-18)
  import Skeleton from "$components/ui/Skeleton.svelte";
  import DataTable, {
    type DataTableColumn,
    type DataTableRowTone,
  } from "$components/ui/DataTable.svelte"; // Issue #853 (D-853-10)
  import ErrorState from "$components/ui/ErrorState.svelte";
  // Issue #853 (owner review): the four Kennzahlen of the prototype's „Zeiten“, worded by the same
  // module Ich › Zeiten uses (#851); one row per day and the day sheet replace the entry table.
  import { standGesternText, zeitenKpis, zeitenStatus } from "$lib/me/zeiten-kpis";
  import {
    DAY_DIFF_TITLE,
    dayDiffText,
    daySaldoByDate,
    daySaldoTitle,
    type DaySaldo,
  } from "$lib/time-entries/day-saldo"; // Issue #1029: the one reader of the server's day series
  import { pauseLabel, teamDayRows, type TeamDayRow } from "$lib/team/zeiten-day-rows";
  import { weekMondaysIn, serverMissingDatesOf } from "$lib/dashboard/heute-im-salon"; // Issue #987
  import DaySheet, { type DaySheetEntry } from "$lib/components/me/DaySheet.svelte";
  import Chip from "$components/ui/Chip.svelte";
  import Modal from "$components/ui/Modal.svelte";
  import ReasonDialog from "$components/ui/ReasonDialog.svelte"; // Quick 260824-cjd
  import { toasts } from "$stores/toast";
  import { salonContext, salonViewApplies, showSalonOptions } from "$stores/salon-context";
  // Issue #70 (D-07, D-12) — the same presentation decisions as the own page.
  import {
    addActionForDay,
    cellClickAction,
    entryCountTitle,
    isDefaultPreset,
    salonFieldOptions,
    salonIdToSend,
  } from "$lib/time-entries/day-entry-actions";
  import {
    TRAVEL_TEXTS,
    isTravelRow,
    travelArrivalOptions,
    travelFormMode,
    travelOfferErrorText,
    postOfferIfStillServed,
    travelOfferPayload,
    travelOffersShown,
    travelPayload,
    travelRouteLabel,
    type TravelRowFields,
  } from "$lib/time-entries/travel-entry-form"; // Issue #92, D-08; offer: Issue #660
  // Issue #85 D-09/D-14 — the Salonansicht. The salon decision lives in team-view.ts (never the raw
  // selection getter); the server decides which hours are visible. Since Issue #1030 it is the hours
  // raster of one salon (`GET /salon-hours`), not a list of entries.
  import { isTeamSalonRejected, teamSalonViewSalon } from "$lib/dashboard/team-view";
  import SalonHoursView from "$lib/components/team/SalonHoursView.svelte";
  import { salonHoursRights } from "$lib/page-rights";
  // Issue #558 D-14 — the header salon narrows only the person selector (the shared page layer;
  // the page never reads the store's raw selection).
  import {
    isSalonFilterRejected,
    salonPageFilter,
    salonScopeLabel,
    withSalonId,
  } from "$lib/salons/page-scope";
  import SalonScopeLabel from "$lib/components/team/SalonScopeLabel.svelte";
  import {
    type SalonHoursResponse,
    type SalonHoursStatus,
    type SalonPeriod,
    defaultSalonPeriod,
    periodAfterSalonChange,
    salonHoursCsvPath,
    salonHoursRequestPath,
    teamModeFor,
  } from "$lib/team/salon-hours";
  import { downloadFromApi } from "$lib/api/download";
  import DayBreakPanel from "$lib/components/breaks/DayBreakPanel.svelte"; // Issue #80
  import DayCheckLine from "$lib/components/breaks/DayCheckLine.svelte"; // Issue #1029
  import { dayBreakPanelVisible } from "$lib/breaks/day-check-line";
  import { createLatestRequestGuard } from "$lib/time-entries/latest-request"; // Issue #660
  // Issue #80 (D-09c/D-10/D-20) — the notification deep link and the server-computed day checks;
  // the browser never derives a cross-salon finding itself.
  import {
    monthAnchorFromDay,
    normalizeDateParam,
    normalizeEmployeeIdParam,
  } from "$lib/breaks/deep-link";
  import {
    type DayCheck,
    type DayCheckTravelOffer,
    type DayCheckWarning,
    type DayChecksResponse,
    type DayWarning,
    breakFindingSaveNotice,
    dayChecksToArbzgMap,
    isChecksRangeAllowed,
  } from "$lib/breaks/day-break-violation";
  // Issue #511 D-18 — the edit form's findings come from the server preview, never from a
  // browser-side rule.
  import {
    type DayPreviewAutoBreak,
    type DayPreviewRequest,
    type DayPreviewResponse,
    buildDayPreviewRequest,
    createDayPreviewRunner,
  } from "$lib/breaks/day-break-preview";
  import { format, startOfMonth, endOfMonth, addMonths, subMonths } from "date-fns";
  import { de } from "date-fns/locale";
  // Phase 116 (GitHub issue #119) — same module the own /time-entries page uses; one answer,
  // two callers, no drift.
  import {
    settledAllowDenied,
    isDenied,
    valueOr,
    anyFailed,
    resolveMonthListState,
    resolveSaldoCardState,
    istOnlyMonthMetrics,
  } from "$lib/time-entries/month-view-state";
  // Issue #986: a day is judged only against the account's Soll the caller may read.
  import {
    judgeZeitenDay,
    mayReadPersonFigures,
    type AccountDayShare,
    type ZeitenDayStatus,
  } from "$lib/team/zeiten-day-judgement";
  import { DENIED } from "$lib/time-entries/month-view-state";
  import {
    getDayExpectedMinutes,
    monthlyHoursWorkDays,
    monthlyHoursDailyRateMinutes,
  } from "$lib/utils/work-schedule";

  interface Break {
    id?: string;
    startTime: string;
    endTime: string;
  }

  // Issue #92: `TravelRowFields` carries the served kind, the arrival salon and its name; the page
  // reads the kind only through `isTravelRow`.
  interface TimeEntry extends TravelRowFields {
    id: string;
    date: string;
    startTime: string;
    endTime: string | null;
    breakMinutes: number;
    breaks?: Break[];
    /** Set while a break is running (break start/stop, #851). */
    breakStartedAt?: string | null;
    type: string;
    source: "NFC" | "MOBILE" | "MANUAL" | "CORRECTION";
    note: string | null;
    isInvalid?: boolean;
    invalidReason?: string | null;
    isLocked?: boolean;
    // Issue #70 — the salon the entry was recorded in (`salonName` is the served display name).
    salonId?: string | null;
    salonName?: string | null;
  }

  interface WorkSchedule {
    type?: "FIXED_SCHEDULE" | "FLEXTIME" | "MONTHLY_HOURS" | "SHIFT_BASED";
    monthlyHours?: number | null;
    mondayHours: string | number;
    tuesdayHours: string | number;
    wednesdayHours: string | number;
    thursdayHours: string | number;
    fridayHours: string | number;
    saturdayHours: string | number;
    sundayHours: string | number;
    workDays?: number[];
  }

  // Issue #986: the status set, and the rule that decides it, live in lib/team/zeiten-day-judgement.ts.
  type CalStatus = ZeitenDayStatus;

  interface CalDay {
    date: Date;
    dateStr: string;
    dayNum: number;
    isCurrentMonth: boolean;
    isToday: boolean;
    isFuture: boolean;
    isWeekend: boolean;
    isHoliday: boolean;
    holidayName: string;
    expectedMin: number;
    workedMin: number;
    /** Issue #986: the account's Ist of the day (entries plus credits); null where not read. */
    creditedMin: number | null;
    hasEntries: boolean;
    // Issue #70 — how many entries the day holds (a cell with several switches to the list).
    entryCount: number;
    status: CalStatus;
    absenceType: string | null;
    absenceHalf: boolean;
    isBeforeHire: boolean;
    // bs-tage-in-calendar — Berufsschultag marker for the visible day. Mutually
    // exclusive in the cell label with absenceType (regular absence wins), but
    // both can be true in data (e.g. half-day vacation falling on a BS day).
    isVocationalSchool: boolean;
    // Issue #448 (D-05): true when this date is a BS date inside a VACATION request
    // (server-provided vocationalSchoolDates) — independent of isVocationalSchool's own
    // `/vocational-school/upcoming` window, so the title is correct even for a past BS date.
    isVocationalSchoolNoLeave: boolean;
  }

  interface PublicHoliday {
    id: string;
    date: string;
    name: string;
  }

  interface Absence {
    id: string;
    startDate: string;
    endDate: string;
    typeCode: string;
    halfDay: boolean;
    // Issue #448 (D-05): BS dates inside this request — [] for every non-VACATION type.
    vocationalSchoolDates?: string[];
  }

  // 260611-ly6 — BS-Absences (Berufsschultage) from GET /vocational-school/upcoming.
  // Rendered as read-only rows in the list view; lifecycle stays on /shifts.
  interface BsAbsence {
    id: string;
    employeeId: string;
    date: string; // YYYY-MM-DD
    source: "PATTERN" | "MANUAL";
  }

  interface Employee {
    id: string;
    firstName: string;
    lastName: string;
    /** Served by GET /employees; the picker finds a person by it. */
    employeeNumber?: string | null;
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let entries: TimeEntry[] = $state([]);
  let schedule = $state<WorkSchedule | null>(null);
  let holidays: Map<string, string> = $state(new Map()); // dateStr → name
  let calendarDays: CalDay[] = $state([]);
  // Phase 116 (issue #119) — starts TRUE so the first painted frame is never "loaded and empty".
  // Safe because BOTH exits of loadAll() clear it: the early return above and the finally below.
  let loading = $state(true);
  let error = $state("");
  let errorLink = $state<{ href: string; label: string } | null>(null); // Issue #1020
  // Phase 116 (issue #119) — true when /settings/work/:id, /overtime/:id or
  // /overtime/month-saldo/:id FAILED, as opposed to legitimately returning nothing.
  let saldoFetchFailed = $state(false);
  // Issue #85 (Phase 76b note) — the server refused the contract, saldo or month-saldo read for
  // this person (403, or the identical 404 of an out-of-scope person). A refusal is not a failure:
  // the figures that depend on it disappear silently and the month cell shows only the Ist of the
  // entries the server returned for the caller's scope. `overtimeDenied` hides the account cell.
  let saldoDenied = $state(false);
  let overtimeDenied = $state(false);
  let saving = $state(false);
  let saveError = $state("");
  let saveErrorLink = $state<{ href: string; label: string } | null>(null); // Issue #1020
  let arbzgEnabled = $state(true);
  // Issue #433 (D-05) — TenantConfig.defaultWorkDays, the MONTHLY_HOURS workday fallback tier
  // (the retired per-tenant holiday-deduction switch, D-04, is gone).
  let defaultWorkDays: number[] | null = $state(null);

  // Issue #1072 - "today" is the TENANT day, never the device or UTC day. The zone is the store's
  // (DEFAULT_TIMEZONE until the layout's read settles); onMount awaits the settled zone and
  // re-anchors before the first request.
  const initialDay = tenantDay(new Date(), $tenantFeatures.timezone);
  let todayStr = $state(initialDay);
  // The tenant day as a calendar anchor, for date-fns arithmetic and wording only (never an instant).
  const todayAnchor = $derived(dayAnchor(todayStr));
  let calMonth = $state(startOfMonth(dayAnchor(initialDay)));
  let fromDate = format(startOfMonth(dayAnchor(initialDay)), "yyyy-MM-dd");
  let toDate = format(endOfMonth(dayAnchor(initialDay)), "yyyy-MM-dd");

  // Ausgewählter Tag
  let selectedDate = $state(initialDay);

  /** Moves the calendar onto a tenant day: its month, the request range and the selection. */
  function anchorOnDay(day: string) {
    calMonth = startOfMonth(dayAnchor(day));
    fromDate = format(startOfMonth(calMonth), "yyyy-MM-dd");
    toDate = format(endOfMonth(calMonth), "yyyy-MM-dd");
    selectedDate = day;
  }

  let deleteConfirmId = $state("");
  // Quick 260824-cjd: Storno now requires a Begründung — confirm UI moved from an
  // inline Ja/Nein span to a ReasonDialog; deleteConfirmId still tracks the target.
  let deleteDialogOpen = $state(false);
  let absences: Absence[] = $state([]);
  // 260611-ly6 — BS-Tage (Berufsschultage) merged into the list view client-side.
  let bsAbsences: BsAbsence[] = $state([]);
  let overtimeTotalHours: number | null = $state(null);
  // Phase 97-05 (SALDO-DISP-01/03/04/07) — additive split fields from GET /overtime/:id,
  // mirroring the employee's own /time-entries (97-01). undefined when the endpoint didn't
  // return the split (older cached response / fail-safe branch). The Gesamtsaldo Kennzahl (#1029)
  // reads only overtimeTotalHours and these two month facts for its forecast wording.
  let overtimeConfirmedMinutes: number | undefined = $state(undefined);
  let overtimeOpenMonthMinutes: number | null | undefined = $state(undefined);
  let overtimeHasClosedMonth: boolean | undefined = $state(undefined);
  // Issue #588 (P-14): how many calendar months the forecast spans; words the card caption.
  let overtimeUnconfirmedMonths: number | null | undefined = $state(undefined);
  let overtimeRosterIncomplete: boolean | undefined = $state(undefined);
  let hireDate: string | null = $state(null); // YYYY-MM-DD oder null
  let shiftMinByDate: Map<string, number> = $state(new Map()); // v1.8.8 — SHIFT_BASED Soll per dateStr
  let teView = $state<"calendar" | "list">("calendar");
  const VIEW_OPTIONS = [
    { value: "calendar", label: "Kalender" },
    { value: "list", label: "Liste" },
  ];

  // §615 Team-Zeiten display: month-saldo from the shared §615 core (SHIFT_BASED only).
  // For non-SHIFT schedule types this stays null and existing derived values apply unchanged.
  interface MonthSaldoDay {
    date: string;
    cumulativeSaldoMinutes: number;
    // Issue #594 (the day step, read by #1029): the account's own day difference; exactly
    // cumulative(D) - cumulative(D-1). Absent on the single terminal entry of a closed month.
    balanceMinutes?: number;
    // Issue #594: the day's own Soll and Ist (credits included) from the account; absent on the
    // single terminal entry of a closed month.
    expectedMinutes?: number;
    workedMinutes?: number;
  }
  interface MonthSaldo {
    workedMinutes: number;
    expectedMinutes: number;
    balanceMinutes: number;
    closed: boolean;
    // Phase 97-05 (SALDO-DISP-07) — SHIFT_BASED open months only; undefined otherwise
    // (never a fabricated false), matching computeMonthSaldo's own contract.
    rosterIncomplete?: boolean;
    // Phase 125 (issue #125) — distinct worked days to date, from the SAME server computation as
    // `workedMinutes`. Absent for a CLOSED month (the SaldoSnapshot stores no day count) —
    // undefined, never a fabricated 0, matching computeMonthSaldo's own contract.
    workedDays?: number;
    // Issue #433 (D-11) — MONTHLY_HOURS with a target only: the FULL calendar month's net Soll,
    // from the SAME saldo core the dashboard tile and the monthly report use. Absent — never a
    // fabricated 0 — for every other schedule type and for pure tracking.
    monthSollMinutes?: number;
    days: MonthSaldoDay[];
    // #86 (D-02): true when the caller may not read this person's day lists (days is then empty).
    dayDetailsWithheld?: boolean;
  }
  let monthSaldo = $state<MonthSaldo | null>(null);
  // Issue #986: the account's day shares (#594) and whether the caller read a Soll at all; both set
  // by loadAll right before the calendar days are built from them.
  let dayShares: Map<string, AccountDayShare> = new Map();
  let daySollReadable = false;
  // Issue #1029: YYYY-MM-DD → the server's day step and running saldo (one mapping, nothing computed
  // in the page); empty for a month the server states no days for and under withheld day details (#86).
  let daySaldo = $derived(
    daySaldoByDate(monthSaldo?.days, monthSaldo?.dayDetailsWithheld === true),
  );

  // Modal
  let modalOpen = $state(false);
  let editEntry = $state<TimeEntry | null>(null);
  let formDate = $state(initialDay);
  let formStart = $state("09:00");
  let formEnd = $state("17:00");
  let formHasEnd = $state(true);
  let formBreaks = $state<{ start: string; end: string }[]>([]);
  let formBreakTotal = $derived(
    formBreaks.reduce((sum, b) => {
      if (!b.start || !b.end) return sum;
      const [sh, sm] = b.start.split(":").map(Number);
      const [eh, em] = b.end.split(":").map(Number);
      const diff = eh * 60 + em - (sh * 60 + sm);
      return sum + (diff > 0 ? diff : 0);
    }, 0),
  );
  let formNetMin = $derived.by(() => {
    if (!formHasEnd || !formStart || !formEnd) return null;
    const [sh, sm] = formStart.split(":").map(Number);
    const [eh, em] = formEnd.split(":").map(Number);
    const gross = eh * 60 + em - (sh * 60 + sm);
    if (gross <= 0) return 0;
    return Math.max(0, gross - formBreakTotal);
  });
  let formNote = $state("");
  // Quick 260824-cjd: mandatory Begründung — required only when this is a
  // Korrektur (editEntry set AND the manager is not the entry's own employee).
  let formReason = $state("");
  // Issue #70 (D-07, D-12): salon options and the salon field exist only where the #64 rule holds
  // (more than one active salon, more than one reachable). The options are the salons the caller
  // reaches from the salon-context store, never the header selection (a view filter, not a booking
  // salon, #87 D-06); the server's per-entry scope check decides regardless (T-70b-28).
  let multiEntryUi = $derived(showSalonOptions($salonContext));
  let formSalonId = $state("");
  let formSalonOptions = $derived(salonFieldOptions($salonContext.salons, editEntry));
  let formSalonPayload = $derived(salonIdToSend(formSalonId, editEntry?.salonId ?? null));
  // Issue #92 (D-06/D-08): the trip form, same rules as on /time-entries. The switch exists only on
  // a NEW entry where the #64 rule holds; an existing trip opens the travel form; any other entry
  // never gets it (the kind is immutable). Von/Nach come from the same reachable-salon options as
  // the salon field - never from the header selection. The server decides whether a trip is
  // recordable.
  let travelMode = $derived(travelFormMode(multiEntryUi, editEntry));
  let formTravel = $state(false);
  let formTravelFrom = $state("");
  let formTravelTo = $state("");
  let travelActive = $derived(travelMode === "travel" || (travelMode === "offer" && formTravel));
  let travelToOptions = $derived(travelArrivalOptions(formSalonOptions, editEntry));
  let defaultBreakStart: string | null = $state(null);
  // Issue #80 (D-20) + Issue #511 D-18 — the server's day checks of the loaded range: the only
  // source of the calendar markers and of the day panels. For a partially scoped manager a day
  // arrives redacted; the page renders it as received and computes no finding itself.
  let dayChecks = $state<DayCheck[]>([]);
  // Issue #660 (WR-03): the person the rendered `dayChecks` were loaded for. An offer is posted
  // for THIS person, never for whoever is selected at click time.
  let dayChecksEmployeeId = $state<string | null>(null);
  // Issue #660 (WR-03): only the response of the latest person load may be applied.
  const loadGuard = createLatestRequestGuard();

  // ── Employee selector state ────────────────────────────────────────────────
  let employees: Employee[] = $state([]);
  let selectedEmployeeId = $state<string | null>(null);

  // Issue #558 D-14: the salon narrows only who can be picked; the chosen person's month is a
  // contract figure and is never split by salon. A person chosen before a salon change stays
  // selected although the narrowed list no longer holds them: the chosen record is the fallback.
  let selectedEmployeeRecord = $state<Employee | null>(null);
  let selectedEmployee = $derived(
    employees.find((e) => e.id === selectedEmployeeId) ??
      (selectedEmployeeRecord !== null && selectedEmployeeRecord.id === selectedEmployeeId
        ? selectedEmployeeRecord
        : null),
  );
  const contextLoaded = $derived($salonContext.loaded);
  const pageSalonId = $derived(salonPageFilter($salonContext));
  const scopeLabel = $derived(salonScopeLabel($salonContext));
  let listRejected = $state(false);
  // Plain let: an older list response never overwrites a newer one. The deep link of `onMount`
  // waits for the first completed list load through `firstListLoaded`.
  let employeeListGeneration = 0;
  let markFirstListLoaded: () => void = () => {};
  const firstListLoaded = new Promise<void>((resolve) => {
    markFirstListLoaded = resolve;
  });

  // ── Salonansicht (Issue #85, D-09; the hours raster since Issue #1030) ─────
  // "person" = the per-person view (unchanged); "salon" = the hours raster of one salon for a week or
  // a month. `mode=salon` in the URL selects the salon view, but only while its tab exists.
  let teamMode = $state<"person" | "salon">("person");
  // The tab exists in a company with more than one active salon (the tenant part of the #64 rule,
  // `salonViewApplies`) for a caller who may read the team overview; a one-salon company has none.
  const salonTabAvailable = $derived(
    salonViewApplies($salonContext) && salonHoursRights($authStore.user).view,
  );
  // The tabs of the Seitenkopf (Issue #853, D-853-10); the order is the order they are shown in.
  const viewTabs = $derived([
    { value: "person", label: "Personenansicht" },
    ...(salonTabAvailable ? [{ value: "salon", label: "Salonansicht" }] : []),
  ]);
  let salonHoursData = $state<SalonHoursResponse | null>(null);
  let salonViewStatus = $state<SalonHoursStatus>("prompt");
  let salonViewError = $state("");
  // The shown week or month; the default is the week of tenant-local yesterday (Issue #1030, P-07).
  let salonPeriod = $state<SalonPeriod>(defaultSalonPeriod(initialDay));
  // A response of an older request (older salon or period) must never overwrite a newer one.
  let salonViewGeneration = 0;
  // The salon comes ONLY from the guarded decision in team-view.ts; primitives keep the effect
  // from re-running on an equal context state.
  const salonViewSalonId = $derived(teamSalonViewSalon($salonContext));
  const salonViewSalonName = $derived(
    $salonContext.salons.find((salon) => salon.id === salonViewSalonId)?.name ?? null,
  );

  // A header salon change returns the period to the default week and remounts the lists, so every
  // list starts at its first page (Issue #1030). Declared BEFORE the load effect, so the single
  // reload that follows already sees the reset period. The first run only records the salon.
  let salonViewKey = $state(0);
  let lastSalonViewSalon: string | null | undefined;
  $effect(() => {
    const next = salonViewSalonId;
    untrack(() => {
      if (lastSalonViewSalon !== undefined && lastSalonViewSalon !== next) {
        salonPeriod = periodAfterSalonChange(lastSalonViewSalon, next, salonPeriod, todayStr);
        salonViewKey += 1;
      }
      lastSalonViewSalon = next;
    });
  });

  $effect(() => {
    if (teamMode !== "salon" || !$salonContext.loaded) return;
    const salonId = salonViewSalonId;
    const period = salonPeriod;
    untrack(() => {
      void loadSalonView(salonId, period);
    });
  });

  // A salon mode without its tab (a deep link, or the tab disappearing with the context) returns
  // to the person view instead of showing a view the tab list does not offer.
  $effect(() => {
    if (!$salonContext.loaded) return;
    if (teamMode === "salon" && teamModeFor("salon", salonTabAvailable) !== "salon") {
      untrack(() => {
        void setTeamMode("person");
      });
    }
  });

  async function loadSalonView(salonId: string | null, period: SalonPeriod) {
    const generation = ++salonViewGeneration;
    salonViewError = "";
    if (salonId === null) {
      salonHoursData = null;
      salonViewStatus = "prompt";
      return;
    }
    salonViewStatus = "loading";
    void loadSalonMasterData();
    try {
      const answer = await api.get<SalonHoursResponse>(salonHoursRequestPath(salonId, period));
      if (generation !== salonViewGeneration) return;
      salonHoursData = answer;
      salonViewStatus = "ready";
    } catch (err) {
      if (generation !== salonViewGeneration) return;
      salonHoursData = null;
      if (isTeamSalonRejected(err)) {
        salonViewStatus = "rejected";
        return;
      }
      salonViewStatus = "error";
      salonViewError = err instanceof Error ? err.message : "Fehler beim Laden";
    }
  }

  // The persons whose day the caller may open: the master-data list (`GET /employees`, narrowed by
  // the caller's reach, #547), loaded once with the first salon view and used by id only. The salon
  // header never narrows it - a person of this salon who is homed elsewhere stays clickable. A
  // failure is non-fatal: no cell becomes a button.
  let salonMasterEmployees = $state<Employee[]>([]);
  let salonMasterRequested = false;
  const salonClickableIds = $derived(
    new Set([...salonMasterEmployees, ...employees].map((e) => e.id)),
  );

  async function loadSalonMasterData() {
    if (salonMasterRequested) return;
    salonMasterRequested = true;
    try {
      salonMasterEmployees = await api.get<Employee[]>("/employees");
    } catch {
      salonMasterEmployees = [];
    }
  }

  // A click on a raster cell: that person's day in the Personenansicht (the existing correction
  // path - the day sheet), in the month of the day.
  async function openPersonDay(employeeId: string, day: string) {
    const person =
      salonMasterEmployees.find((e) => e.id === employeeId) ??
      employees.find((e) => e.id === employeeId);
    if (!person) return;
    teamMode = "person";
    const [year, month] = day.split("-").map(Number);
    calMonth = new Date(year, month - 1, 1);
    fromDate = format(startOfMonth(calMonth), "yyyy-MM-dd");
    toDate = format(endOfMonth(calMonth), "yyyy-MM-dd");
    selectedDate = day;
    selectedEmployeeId = person.id;
    selectedEmployeeRecord = person;
    await loadAll();
    syncAddress();
    openDaySheet(day);
  }

  // The CSV of the exchange card: the very salon and period on screen. The API writes the audit row
  // before the bytes and refuses a caller without report:export; the button exists only with it.
  async function exportSalonHours() {
    const salonId = salonViewSalonId;
    if (salonId === null) return;
    try {
      await downloadFromApi(salonHoursCsvPath(salonId, salonPeriod), "salon-austausch.csv");
      toasts.success("Der Austausch mit anderen Salons wurde als CSV heruntergeladen.");
    } catch {
      toasts.error(
        "Der Austausch mit anderen Salons konnte nicht exportiert werden. Bitte versuch es noch einmal.",
      );
    }
  }

  async function setTeamMode(mode: "person" | "salon") {
    if (teamMode === mode) return;
    teamMode = mode;
    // The person view skips its month loads while the salon view is shown; catch up on return.
    if (mode === "person") await loadAll();
    syncAddress();
  }

  // Issue #853 (D-853-10): the picker's items. A person kept selected across a salon change (the
  // chosen record, see above) stays in the list so the picker keeps showing who is chosen.
  let pickerItems = $derived(
    personOptions(
      selectedEmployee !== null && !employees.some((e) => e.id === selectedEmployee.id)
        ? [...employees, selectedEmployee]
        : employees,
    ),
  );

  // Issue #992 (N-07, D-992-12): Heute im Salon › „Zeit eintragen“ arrives with `eintragen=1`. Without a
  // person in the link the picker gets the focus and the add dialog opens once a person is chosen; the
  // flag never survives that one choice.
  let addAfterPick = $state(false);
  let pickerHost: HTMLElement | null = $state(null);

  async function pickEmployee(id: string) {
    const emp = employees.find((e) => e.id === id);
    if (!emp) return;
    const addNow = addAfterPick;
    addAfterPick = false;
    await selectEmployee(emp);
    if (addNow) openAdd(todayStr);
  }

  async function focusPicker() {
    await tick();
    pickerHost?.querySelector("input")?.focus();
  }

  // ── Laden ─────────────────────────────────────────────────────────────────
  onMount(async () => {
    // Issue #86 (AC-86-3): the page's own permission, checked before any request. A caller who
    // only holds the team leave read (e.g. the Personalabteilung) is sent to the leave page; the
    // team layout's OR-guard lets them in, the API would answer 403 to every time read. UX only.
    if (!mayOpenTeamPage("/team/time-entries", $authStore.user)) {
      await goto(
        mayOpenTeamPage("/team/leave", $authStore.user)
          ? "/team/abwesenheiten"
          : homeHref($authStore.user),
      );
      return;
    }
    // Issue #992 (D-992-12): read once, before the first address write drops the parameter.
    const addOnLoad =
      addOnArrival(page.url.searchParams) &&
      hasPermission($authStore.user, "time-entry:create:ZUGEWIESEN");
    // Issue #1072 (R-A): the month of the first request derives from now, so the tenant's zone is
    // awaited first (a child's onMount runs before the layout's read settles).
    todayStr = tenantDay(new Date(), await tenantFeatures.loadTimezone());
    // Issue #1030 (P-07) with #1072: the salon view's default period follows the settled tenant day.
    salonPeriod = defaultSalonPeriod(todayStr);
    // Read URL params
    const viewParam = page.url.searchParams.get("view");
    if (viewParam === "list") teView = "list";
    if (page.url.searchParams.get("mode") === "salon") {
      // The salon context decides whether the tab exists; the effect above returns an unavailable mode.
      teamMode = "salon";
    }
    // Issue #80 (D-10): the param is untrusted text — an unreal day keeps the default month
    // instead of reaching date-fns with an Invalid Date. The calendar is anchored on the 1st of
    // the linked month while the linked day stays selectedDate (quick 261009-bsb).
    const dateParam = normalizeDateParam(page.url.searchParams.get("date"));
    if (!dateParam) {
      anchorOnDay(todayStr);
      formDate = todayStr;
      pickerYear = Number(todayStr.slice(0, 4));
    }
    if (dateParam) {
      selectedDate = dateParam;
      calMonth = monthAnchorFromDay(dateParam);
      fromDate = format(startOfMonth(calMonth), "yyyy-MM-dd");
      toDate = format(endOfMonth(calMonth), "yyyy-MM-dd");
    }

    // Issue #80 (D-10): the BREAK_CROSS_SALON_VIOLATION notification link preselects the
    // employee. Only an id present in the caller's own list counts — an unknown or foreign id
    // selects nobody, and the server scopes every read anyway. The list itself is loaded by the
    // salon effect below (Issue #558); the link waits for its first completed load.
    const linkedEmployeeId = normalizeEmployeeIdParam(page.url.searchParams.get("employeeId"));
    if (linkedEmployeeId) {
      await firstListLoaded;
      let linked = employees.find((e) => e.id.toLowerCase() === linkedEmployeeId);
      // Issue #558 D-14: a salon filter narrows the list, so a linked person of another salon is
      // looked up once in the UNFILTERED list before the Salonansicht fallback applies.
      if (!linked && pageSalonId !== null) {
        try {
          const all = await api.get<Employee[]>("/employees");
          linked = all.find((e) => e.id.toLowerCase() === linkedEmployeeId);
        } catch {
          // Non-fatal — the Salonansicht fallback below applies.
        }
      }
      if (linked) await selectEmployee(linked);
      // Issue #85 (D-14): the employee list is narrowed to the caller's master-data reach (#547),
      // while a manager of the Einsatzsalon still sees that salon's entries of the linked day. A
      // linked person outside the list therefore opens the Salonansicht of the linked month
      // (already anchored by the `date` param above) instead of doing nothing.
      else teamMode = teamModeFor("salon", salonTabAvailable);
    }
    // Without a (valid) employee link do NOT call loadAll() here — wait for employee selection
    if (addOnLoad && teamMode === "person") {
      if (selectedEmployeeId !== null) {
        // The link named a person: the dialog opens at once.
        openAdd(todayStr);
      } else {
        addAfterPick = true;
        await focusPicker();
      }
    }
  });

  // Issue #558 D-14: the effect owns the list loads; it waits for the salon context so the first
  // request is already filtered, and reloads when the header salon changes.
  $effect(() => {
    if (!contextLoaded) return;
    const salonId = pageSalonId;
    untrack(() => {
      void loadEmployeeList(salonId);
    });
  });

  async function loadEmployeeList(salonId: string | null) {
    // Issue #86: no request for a caller who may not open the page (the onMount guard redirects).
    if (!mayOpenTeamPage("/team/time-entries", $authStore.user)) return;
    const generation = ++employeeListGeneration;
    try {
      const raw = await api.get<Employee[]>(withSalonId("/employees", salonId));
      if (generation !== employeeListGeneration) return;
      employees = raw.sort((a, b) => {
        const ln = a.lastName.localeCompare(b.lastName, "de");
        return ln !== 0 ? ln : a.firstName.localeCompare(b.firstName, "de");
      });
      listRejected = false;
    } catch (err) {
      if (generation !== employeeListGeneration) return;
      // Non-fatal — the selector stays empty. Only the one 404 of an inadmissible salon is
      // announced, as a calm text and never a toast.
      employees = [];
      listRejected = isSalonFilterRejected(err);
    }
    markFirstListLoaded();
  }

  // Issue #987: the days the SERVER named „missing“ (`resolveDayStatus`, via the team week) for the
  // shown person and month; null = no statement (no reach for the team overview, no contract), the
  // page then keeps its own reading. The page never decides „missing“ for a person the server judged.
  let serverMissing = $state<Set<string> | null>(null);
  async function loadServerMissing(empId: string): Promise<Set<string> | null> {
    const next = new Date(`${toDate}T00:00:00Z`).getTime() + 86_400_000;
    const end = new Date(next).toISOString().slice(0, 10);
    const exclusive = end < todayStr ? end : todayStr;
    if (exclusive <= fromDate) return new Set();
    const results = await Promise.allSettled(
      weekMondaysIn(fromDate, exclusive).map((monday) =>
        api.get<Parameters<typeof serverMissingDatesOf>[0][number]>(
          `/dashboard/team-week?date=${monday}`,
        ),
      ),
    );
    const weeks = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    // An unanswered week would read as „nothing missing“; without every week there is no statement.
    if (weeks.length !== results.length) return null;
    const missing = serverMissingDatesOf(weeks, empId);
    return missing === null
      ? null
      : new Set([...missing].filter((d) => d >= fromDate && d <= toDate && d < todayStr));
  }

  async function loadAll() {
    // The salon view loads its own month (see the effect above); nothing to do for the person view.
    if (teamMode === "salon") return;
    const loadToken = loadGuard.begin();
    // Issue #660 (WR-03): the checks of the previous person must not stay clickable while the
    // next ones load.
    dayChecks = [];
    dayChecksEmployeeId = null;
    if (!selectedEmployeeId) {
      entries = [];
      schedule = null;
      holidays = new Map();
      absences = [];
      bsAbsences = [];
      overtimeTotalHours = null;
      // Phase 97-05 — reset the split fields alongside the legacy total.
      overtimeConfirmedMinutes = undefined;
      overtimeOpenMonthMinutes = undefined;
      overtimeHasClosedMonth = undefined;
      overtimeUnconfirmedMonths = undefined;
      overtimeRosterIncomplete = undefined;
      hireDate = null;
      shiftMinByDate = new Map();
      monthSaldo = null;
      calendarDays = [];
      dayChecks = [];
      // Phase 116 (issue #119) — clear the flag on the path that never sets it. `loading` now
      // starts TRUE (see its declaration), and this branch returns before the try/finally that
      // would otherwise clear it. Without this line the page would sit in a permanent skeleton
      // until an employee is selected — `onMount` deliberately does not call loadAll() here.
      loading = false;
      return;
    }
    loading = true;
    error = "";
    errorLink = null;
    saldoFetchFailed = false;
    saldoDenied = false;
    overtimeDenied = false;
    try {
      const year = calMonth.getFullYear();
      const empId = selectedEmployeeId;
      // Issue #986: a read the caller's permission set refuses anyway is not sent (it only produced a
      // 403); it counts as refused, exactly like the server's answer would.
      const mayReadContract = mayReadPersonFigures($authStore.user, "contract", empId);
      const mayReadOvertime = mayReadPersonFigures($authStore.user, "overtime", empId);
      const [
        rawEntries,
        rawSchedule,
        rawHolidays,
        rawAbsences,
        rawOvertime,
        rawEmployee,
        rawConfig,
        rawBsAbsences,
        rawDayChecks,
      ] = await Promise.all([
        api.get<TimeEntry[]>(`/time-entries?from=${fromDate}&to=${toDate}&employeeId=${empId}`),
        mayReadContract
          ? settledAllowDenied(api.get<WorkSchedule>(`/settings/work/${empId}`))
          : Promise.resolve(DENIED),
        api.get<PublicHoliday[]>(`/holidays?year=${year}`).catch(() => [] as PublicHoliday[]),
        api
          .get<Absence[]>(`/leave/requests?status=APPROVED&employeeId=${empId}`)
          .catch(() => [] as Absence[]),
        mayReadOvertime
          ? settledAllowDenied(
              api.get<{
                balanceHours: number;
                // Phase 97-05 (SALDO-DISP-01/03/04/07) — additive split fields.
                confirmedMinutes?: number;
                openMonthMinutes?: number | null;
                hasClosedMonth?: boolean;
                unconfirmedMonths?: number | null;
                rosterIncomplete?: boolean;
              }>(`/overtime/${empId}`),
            )
          : Promise.resolve(DENIED),
        api.get<{ hireDate?: string }>(`/employees/${empId}`).catch(() => null),
        api
          .get<{
            arbzgEnabled?: boolean;
            defaultBreakStart?: string | null;
            defaultWorkDays?: number[];
          }>("/settings/work")
          .catch(() => null),
        // 260611-ly6 — Berufsschultage (BS) for the selected employee in the current
        // window. Failure tolerated (empty array) so the rest of the page renders.
        api
          .get<BsAbsence[]>(
            `/vocational-school/upcoming?from=${fromDate}&to=${toDate}&employeeId=${empId}`,
          )
          .catch(() => [] as BsAbsence[]),
        // Issue #80 (D-09c/D-20) — server day checks for the shown range. Non-fatal: a failed
        // check must never break the page, and the call is skipped for a range the API refuses.
        isChecksRangeAllowed(fromDate, toDate)
          ? api
              .get<DayChecksResponse>(
                `/day-breaks/checks?employeeId=${empId}&from=${fromDate}&to=${toDate}`,
              )
              .catch(() => null)
          : Promise.resolve(null),
      ]);
      // Issue #660 (WR-03): a newer load started meanwhile; this response belongs to a person or
      // month that is no longer shown.
      if (!loadGuard.isCurrent(loadToken)) return;
      const missingAnswer = await loadServerMissing(empId);
      if (!loadGuard.isCurrent(loadToken)) return;
      serverMissing = missingAnswer;
      entries = rawEntries;
      dayChecks = rawDayChecks?.days ?? [];
      dayChecksEmployeeId = rawDayChecks ? rawDayChecks.employeeId : null;
      schedule = valueOr(rawSchedule, null);
      holidays = new Map(rawHolidays.map((h) => [h.date.split("T")[0], h.name]));
      absences = rawAbsences;
      bsAbsences = rawBsAbsences;
      const overtimeValue = valueOr(rawOvertime, null);
      overtimeTotalHours = overtimeValue ? Number(overtimeValue.balanceHours) : null;
      // Phase 97-05 — split fields, undefined when the endpoint didn't return them (older
      // cached response / fail-safe branch).
      overtimeConfirmedMinutes = overtimeValue?.confirmedMinutes;
      overtimeOpenMonthMinutes = overtimeValue?.openMonthMinutes;
      overtimeHasClosedMonth = overtimeValue?.hasClosedMonth;
      overtimeUnconfirmedMonths = overtimeValue?.unconfirmedMonths;
      overtimeRosterIncomplete = overtimeValue?.rosterIncomplete;
      // Phase 116 (issue #119) — a 500 here used to become `schedule = null`, which monthMetrics
      // turns into `sollToDateMin: 0`, which SollIstBar prints as "noch keine Sollzeit in diesem
      // Monat". Now it reaches MonatSaldoCard's existing error branch instead.
      saldoFetchFailed = anyFailed(rawSchedule, rawOvertime);
      overtimeDenied = isDenied(rawOvertime);
      saldoDenied = isDenied(rawSchedule, rawOvertime);
      hireDate = rawEmployee?.hireDate ? rawEmployee.hireDate.split("T")[0] : null;
      arbzgEnabled = rawConfig?.arbzgEnabled !== false;
      defaultBreakStart = rawConfig?.defaultBreakStart ?? null;
      defaultWorkDays = rawConfig?.defaultWorkDays ?? null;
      // v1.8.8 — fetch Shift rows for SHIFT_BASED so the calendar can render Soll.
      // Other schedule types compute expectedMin via getDayExpectedHours (D-03 returns 0
      // for SHIFT_BASED — this page-level wiring fills the gap).
      // The account's month (GET /overtime/month-saldo) for every schedule type with a Soll
      // (Issue #986; before only SHIFT_BASED and, Issue #433 D-11, MONTHLY_HOURS with a target). It
      // feeds the month header SOLL(BISHER)/IST/MONAT-SALDO, the MONTHLY_HOURS header's
      // monthSollMinutes, the SHIFT_BASED cumulative cells and the day shares (#594) every day is
      // judged against - a Berufsschule credit is inside those shares, never a minus. GESAMT-SALDO
      // is NOT sourced from here (it must be month-INDEPENDENT — see the Gesamtsaldo Kennzahl,
      // bound to the live lifetime GET /overtime/:id, Issue #1029). Not read when the contract or the account was
      // already refused: then nothing is judged at all.
      const isMonthlyHoursWithTarget =
        schedule?.type === "MONTHLY_HOURS" && Number(schedule.monthlyHours ?? 0) > 0;
      const isTrackOnlyMonthly = schedule?.type === "MONTHLY_HOURS" && !isMonthlyHoursWithTarget;
      if (schedule && !saldoDenied && !isTrackOnlyMonthly) {
        // Phase 116 (issue #119) — for SHIFT_BASED this endpoint is THE source of every figure
        // MonatSaldoCard shows. On failure monthMetrics silently fell through to the
        // FIXED_*/FLEXTIME branch and rendered a DIFFERENT, wrong number as fact.
        const rawMonthSaldo = await settledAllowDenied(
          api.get<MonthSaldo>(
            `/overtime/month-saldo/${empId}?year=${calMonth.getFullYear()}&month=${calMonth.getMonth() + 1}`,
          ),
        );
        if (!loadGuard.isCurrent(loadToken)) return;
        monthSaldo = valueOr(rawMonthSaldo, null);
        if (anyFailed(rawMonthSaldo)) saldoFetchFailed = true;
        if (isDenied(rawMonthSaldo)) saldoDenied = true;
        // Issue #433 (D-11) — a MONTHLY_HOURS-with-target response missing monthSollMinutes must
        // never render as a fabricated 0; route it into the same error branch as a failed fetch.
        if (isMonthlyHoursWithTarget && monthSaldo && monthSaldo.monthSollMinutes === undefined) {
          saldoFetchFailed = true;
        }
      } else {
        monthSaldo = null;
      }

      if (schedule?.type === "SHIFT_BASED") {
        const rawShifts = await api
          .get<Array<{ date: string; durationMin: number; durationMinNetto: number }>>(
            `/shifts/range?from=${fromDate}&to=${toDate}&employeeId=${empId}`,
          )
          .catch(
            () => [] as Array<{ date: string; durationMin: number; durationMinNetto: number }>,
          );
        if (!loadGuard.isCurrent(loadToken)) return;
        const m = new Map<string, number>();
        for (const s of rawShifts) {
          // v1.8.9 — Soll = netto (brutto − getEffectiveBreakDuration on the server).
          // Compares apples-to-apples against IST (worked minutes already netto in sumWorked).
          m.set(s.date, (m.get(s.date) ?? 0) + s.durationMinNetto);
        }
        shiftMinByDate = m;
      } else {
        shiftMinByDate = new Map();
      }
      // Issue #986: a Soll is judged only when the contract and the account were both read; the
      // account's day shares are used only where the server sent them (#86 may withhold them).
      daySollReadable = !!schedule && !saldoDenied && !saldoFetchFailed;
      dayShares = new Map(
        monthSaldo && monthSaldo.dayDetailsWithheld !== true
          ? monthSaldo.days.map((d) => [
              d.date,
              { expectedMinutes: d.expectedMinutes, workedMinutes: d.workedMinutes },
            ])
          : [],
      );
      // Issue #987 over #986: the server's day status (`resolveDayStatus`) marks a missing day
      // even where no Soll is readable — it is no Soll judgement, so it is laid over the result.
      calendarDays = applyServerMissing(
        buildCalendarDays(
          calMonth,
          entries,
          schedule,
          holidays,
          absences,
          hireDate,
          schedule?.type === "MONTHLY_HOURS",
          shiftMinByDate,
          bsAbsences,
        ),
        serverMissing,
      );
    } catch (e: unknown) {
      if (loadGuard.isCurrent(loadToken)) {
        error = e instanceof Error ? e.message : "Fehler beim Laden";
      }
    } finally {
      // A superseded run leaves `loading` to the run that replaced it.
      if (loadGuard.isCurrent(loadToken)) loading = false;
    }
  }

  async function selectEmployee(emp: Employee) {
    selectedEmployeeId = emp.id;
    selectedEmployeeRecord = emp;
    await loadAll();
    syncAddress();
  }

  // Issue #992 (N-05, D-992-10): the chosen person and the selected day live in the address (`replaceState`,
  // no history entry), so a link to „die Person, November“ can be passed on. `view` stays; `eintragen` goes.
  function syncAddress() {
    try {
      const url = new URL(page.url.href);
      url.search = teamZeitenSearch(page.url.searchParams, {
        mode: teamMode,
        employeeId: selectedEmployeeId,
        date: selectedDate,
      }).toString();
      replaceState(url, {});
    } catch {
      // The router is not ready or the URL is unusable: the address just stays as it is, harmless.
    }
  }

  let showMonthPicker = $state(false);
  let pickerYear = $state(Number(initialDay.slice(0, 4)));

  async function gotoMonth(dir: 1 | -1) {
    calMonth = dir === 1 ? addMonths(calMonth, 1) : subMonths(calMonth, 1);
    fromDate = format(startOfMonth(calMonth), "yyyy-MM-dd");
    toDate = format(endOfMonth(calMonth), "yyyy-MM-dd");
    selectedDate = fromDate;
    await loadAll();
    syncAddress();
  }

  async function gotoMonthYear(m: number, y: number) {
    calMonth = new Date(y, m - 1, 1);
    fromDate = format(startOfMonth(calMonth), "yyyy-MM-dd");
    toDate = format(endOfMonth(calMonth), "yyyy-MM-dd");
    selectedDate = fromDate;
    showMonthPicker = false;
    await loadAll();
    syncAddress();
  }

  async function gotoToday() {
    todayStr = tenantDay(new Date(), $tenantFeatures.timezone);
    anchorOnDay(todayStr);
    showMonthPicker = false;
    await loadAll();
    syncAddress();
  }

  const MONTH_NAMES_SHORT = [
    "Jan",
    "Feb",
    "Mär",
    "Apr",
    "Mai",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Okt",
    "Nov",
    "Dez",
  ];

  // ── Kalender-Tage aufbauen ─────────────────────────────────────────────────
  function buildCalendarDays(
    monthDate: Date,
    entries: TimeEntry[],
    sched: WorkSchedule | null,
    hols: Map<string, string>,
    absenceList: Absence[],
    hireDateStr: string | null = null,
    monthly: boolean = false,
    shiftMinByDate: Map<string, number> = new Map(), // v1.8.8 — sum of durationMin per dateStr for SHIFT_BASED
    bsAbsenceList: BsAbsence[] = [], // bs-tage-in-calendar — Berufsschultage to mark in the calendar
  ): CalDay[] {
    // Defense in depth (quick 261009-bsb, Issue #80): the padding before the 1st, the walk to
    // endOfMonth and monthlyHoursDailyRateMinutes all assume the 1st; a mid-month argument
    // truncated the grid and the summed Soll, so the month is normalized here and no caller can
    // reintroduce it.
    const monthStart = startOfMonth(monthDate);
    const byDate = new Map<string, TimeEntry[]>();
    for (const e of entries) {
      const key = (e.date ?? e.startTime).split("T")[0];
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key)!.push(e);
    }

    // Issue #448 (D-05): BS dates inside a VACATION request, server-provided — skipped below so
    // the cell never renders "Urlaub" for that day.
    const bsNoLeaveDates = new Set<string>();
    for (const abs of absenceList) {
      for (const d of abs.vocationalSchoolDates ?? []) bsNoLeaveDates.add(d);
    }

    // Abwesenheitstage auflösen: Datumsbereich → Map<dateStr, {type, half}>
    const absenceByDate = new Map<string, { type: string; half: boolean }>();
    for (const abs of absenceList) {
      const start = new Date(abs.startDate.split("T")[0]);
      const end = new Date(abs.endDate.split("T")[0]);
      const cur = new Date(start);
      while (cur <= end) {
        const key = format(cur, "yyyy-MM-dd");
        if (!bsNoLeaveDates.has(key)) {
          absenceByDate.set(key, { type: abs.typeCode, half: abs.halfDay });
        }
        cur.setDate(cur.getDate() + 1);
      }
    }

    // bs-tage-in-calendar — Berufsschultage als Set<dateStr> für O(1) Lookup
    // im makeCalDay-Loop. BsAbsence ist per definitionem single-day; kein
    // Range-Walk wie bei regular Absences nötig.
    const bsByDate = new Set<string>(bsAbsenceList.map((b) => b.date));

    // Issue #433 (D-05/D-06) — MONTHLY_HOURS per-day rate: display mirror of the server's
    // workday set and Ø rate. Holidays stay in the denominator (no toggle, no redistribution —
    // the retired per-tenant holiday-deduction switch, D-04, is gone); the authoritative month
    // Soll is the server's monthSollMinutes (header, above).
    let dailySollMin = 0;
    if (monthly && sched) {
      const monthlyBudgetMin = Number(sched.monthlyHours ?? 0) * 60;
      if (monthlyBudgetMin > 0) {
        dailySollMin = monthlyHoursDailyRateMinutes(
          sched,
          monthStart,
          monthlyBudgetMin,
          defaultWorkDays,
        );
      }
    }

    const monthEnd = endOfMonth(monthStart);
    const firstDow = (monthStart.getDay() + 6) % 7;
    const lastDow = (monthEnd.getDay() + 6) % 7;
    const days: CalDay[] = [];

    for (let i = firstDow - 1; i >= 0; i--) {
      const d = new Date(monthStart);
      d.setDate(d.getDate() - i - 1);
      days.push(
        makeCalDay(
          d,
          false,
          byDate,
          sched,
          hols,
          absenceByDate,
          hireDateStr,
          monthly,
          dailySollMin,
          shiftMinByDate,
          bsByDate,
          bsNoLeaveDates,
        ),
      );
    }
    const cur = new Date(monthStart);
    while (cur <= monthEnd) {
      days.push(
        makeCalDay(
          new Date(cur),
          true,
          byDate,
          sched,
          hols,
          absenceByDate,
          hireDateStr,
          monthly,
          dailySollMin,
          shiftMinByDate,
          bsByDate,
          bsNoLeaveDates,
        ),
      );
      cur.setDate(cur.getDate() + 1);
    }
    const remaining = (7 - ((lastDow + 1) % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(monthEnd);
      d.setDate(d.getDate() + i);
      days.push(
        makeCalDay(
          d,
          false,
          byDate,
          sched,
          hols,
          absenceByDate,
          hireDateStr,
          monthly,
          dailySollMin,
          shiftMinByDate,
          bsByDate,
          bsNoLeaveDates,
        ),
      );
    }
    return days;
  }

  // Issue #987: where the server answered, it alone decides „Fehlt“ on a day without entries: a day
  // it names is marked, a day the page's own reading marked but the server did not is a plain day.
  function applyServerMissing(days: CalDay[], missing: Set<string> | null): CalDay[] {
    if (missing === null) return days;
    return days.map((d) => {
      if (d.hasEntries || d.isFuture || d.isToday) return d;
      if (missing.has(d.dateStr)) return d.status === "missing" ? d : { ...d, status: "missing" };
      return d.status === "missing" ? { ...d, status: "noExpect" } : d;
    });
  }

  function makeCalDay(
    date: Date,
    isCurrentMonth: boolean,
    byDate: Map<string, TimeEntry[]>,
    sched: WorkSchedule | null,
    hols: Map<string, string>,
    absenceByDate: Map<string, { type: string; half: boolean }>,
    hireDateStr: string | null = null,
    monthly: boolean = false,
    dailySollMin: number = 0,
    shiftMinByDate: Map<string, number> = new Map(), // v1.8.8 — SHIFT_BASED Soll override
    bsByDate: Set<string> = new Set(), // bs-tage-in-calendar — set of yyyy-MM-dd that are Berufsschultage
    bsNoLeaveDates: Set<string> = new Set(), // Issue #448 (D-05) — BS dates inside a VACATION request
  ): CalDay {
    const dateStr = format(date, "yyyy-MM-dd");
    const isToday = dateStr === todayStr;
    const isFuture = dateStr > todayStr;
    const dow = date.getDay(); // 0=So, 6=Sa
    const isWeekend = dow === 0 || dow === 6;
    const isHoliday = hols.has(dateStr);
    const holidayName = hols.get(dateStr) ?? "";
    const slots = byDate.get(dateStr) ?? [];
    const workedMin = sumWorked(slots);
    const hasEntries = slots.length > 0;

    const absence = absenceByDate.get(dateStr);
    const absenceType = absence?.type ?? null;
    const absenceHalf = absence?.half ?? false;
    const isBeforeHire = hireDateStr ? dateStr < hireDateStr : false;

    // Soll-Stunden: Feiertage + ganztägige Abwesenheiten zählen nicht; Tage vor hireDate = 0
    // MONTHLY_HOURS: apply dailySollMin to the D-05 workday set (Issue #433).
    // v1.8.8 — SHIFT_BASED: expectedMin comes from Shift rows (D-03 returns 0 intentionally).
    let expectedMin: number;
    if (monthly) {
      const isWorkday =
        dailySollMin > 0 && sched && monthlyHoursWorkDays(sched, defaultWorkDays).includes(dow);
      expectedMin = isWorkday ? dailySollMin : 0;
    } else if (sched?.type === "SHIFT_BASED") {
      // Soll for SHIFT_BASED comes from Shift rows (D-03). Sum already done
      // when building the map (multi-shift days).
      expectedMin = shiftMinByDate.get(dateStr) ?? 0;
    } else {
      expectedMin = sched ? getDayExpectedMinutes(sched, date) : 0;
    }
    if (isBeforeHire) expectedMin = 0;
    if (isHoliday) expectedMin = 0;
    else if (absence && !absence.half) expectedMin = 0;
    else if (absence && absence.half) expectedMin = Math.round(expectedMin / 2);

    // bs-tage-in-calendar — Berufsschultag flag for this day. Single Set lookup;
    // independent of regular absenceType so half-day vacations on a BS day still
    // surface the BS marker for the cell when the regular absence does not paint
    // the cell (e.g. weekend BS, half-day vacation).
    const isVocationalSchool = bsByDate.has(dateStr);
    const isVocationalSchoolNoLeave = bsNoLeaveDates.has(dateStr);

    // Issue #986: the status, the Soll shown and the account's Ist of the day come from the one
    // judgement module - from the account's day share where the caller read it, never a guess.
    const judged = judgeZeitenDay({
      isFuture,
      isToday,
      hasEntries,
      entryWorkedMin: workedMin,
      fullAbsence: !!absence && !absence.half,
      monthly,
      sollReadable: daySollReadable,
      share: dayShares.get(dateStr) ?? null,
      rosterExpectedMin: sched?.type === "SHIFT_BASED" && !monthly ? expectedMin : null,
      contractExpectedMin: expectedMin,
      isVocationalSchool: isVocationalSchool || isVocationalSchoolNoLeave,
    });

    return {
      date,
      dateStr,
      dayNum: date.getDate(),
      isCurrentMonth,
      isToday,
      isFuture,
      isWeekend,
      isHoliday,
      holidayName,
      expectedMin: judged.expectedMin,
      workedMin,
      creditedMin: judged.creditedMin,
      hasEntries,
      entryCount: slots.length,
      status: judged.status,
      absenceType,
      absenceHalf,
      isBeforeHire,
      isVocationalSchool,
      isVocationalSchoolNoLeave,
    };
  }

  // ── Hilfsfunktionen ────────────────────────────────────────────────────────
  function sumWorked(slots: TimeEntry[]): number {
    return slots.reduce((sum, e) => {
      if (!e.endTime || e.isInvalid) return sum;
      return (
        sum +
        Math.floor((new Date(e.endTime).getTime() - new Date(e.startTime).getTime()) / 60000) -
        (e.breakMinutes ?? 0)
      );
    }, 0);
  }

  function fmtTime(iso: string | null): string {
    if (!iso) return "–";
    return format(new Date(iso), "HH:mm");
  }

  function fmtMin(min: number): string {
    const h = Math.floor(Math.abs(min) / 60);
    const m = Math.abs(min) % 60;
    return `${h}:${String(m).padStart(2, "0")}`;
  }

  function balClass(min: number): string {
    if (min > 0) return "pos";
    if (min < 0) return "neg";
    return "";
  }

  function sourceLabel(s: TimeEntry["source"]): string {
    return s === "NFC"
      ? "NFC"
      : s === "MOBILE"
        ? "Mobil"
        : s === "CORRECTION"
          ? "Korrektur"
          : "Manuell";
  }

  function slotNet(e: TimeEntry): string {
    if (!e.endTime) return "läuft…";
    const net =
      Math.floor((new Date(e.endTime).getTime() - new Date(e.startTime).getTime()) / 60000) -
      (e.breakMinutes ?? 0);
    return net < 0 ? "–" : fmtMin(net) + " h";
  }

  // ── Modal ─────────────────────────────────────────────────────────────────
  function addMinutesToTime(time: string, minutes: number): string {
    const [h, m] = time.split(":").map(Number);
    const total = h * 60 + m + minutes;
    const nh = Math.floor(total / 60) % 24;
    const nm = total % 60;
    return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
  }

  // The loaded rows of one calendar day, in the order the API served them.
  function rowsOfDay(day: string): TimeEntry[] {
    return entries.filter((e) => (e.date ?? e.startTime).split("T")[0] === day);
  }

  function openAdd(forDate?: string) {
    const targetDate = forDate ?? selectedDate;
    // Without salon options a day that already has an entry opens that entry for editing; with
    // them it opens a new form (D-12, see addActionForDay).
    const action = addActionForDay(rowsOfDay(targetDate), multiEntryUi);
    if (action.kind === "edit") {
      openEdit(action.entry);
      return;
    }
    openNew(targetDate, action.start, action.end);
  }

  function openNew(targetDate: string, start: string, end: string) {
    editEntry = null;
    formDate = targetDate;
    formStart = start;
    formEnd = end;
    formHasEnd = true;
    formSalonId = "";
    formTravel = false;
    formTravelFrom = "";
    formTravelTo = "";
    // The usual 30 minute break is preset for the plain default day only; a further entry that
    // continues after the day's last one gets none (a break there would lie at its very start).
    if (defaultBreakStart && isDefaultPreset({ start, end })) {
      formBreaks = [{ start: defaultBreakStart, end: addMinutesToTime(defaultBreakStart, 30) }];
    } else {
      formBreaks = [];
    }
    formNote = "";
    formReason = "";
    saveError = "";
    saveErrorLink = null;
    modalOpen = true;
  }

  // Issue #70: a further entry on the day of the entry being edited. The unsaved edit of the open
  // dialog is dropped, exactly like Abbrechen.
  function openAdditionalEntry(day: string) {
    const action = addActionForDay(rowsOfDay(day), true);
    if (action.kind !== "new") return;
    closeModal();
    openNew(day, action.start, action.end);
  }

  // Issue #853 (AC-4): the Kalender/Liste switch sits above the figures strip, which on a phone fills
  // the first screen - the chosen view is brought into the viewport (`nearest`: a view that is already
  // visible does not move the page), so the click's result is never out of sight.
  async function selectView(value: string) {
    teView = value === "list" ? "list" : "calendar";
    await tick();
    document
      .querySelector(teView === "list" ? '[data-testid="team-time-entries-list"]' : ".cal-section")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // Issue #853 (owner review, prototype „Zeiten“): a day is read first. A calendar cell with entries
  // opens the day sheet (the same one the list's „Öffnen“ opens); an empty cell opens the new form.
  function onCellClick(day: string) {
    const action = cellClickAction(rowsOfDay(day));
    if (action.kind === "new") openAdd(day);
    else openDaySheet(day);
  }

  // The tooltip of a calendar cell: its own reason (holiday, absence, ...) plus the entry count.
  // Issue #1029: with the server's day step and the labelled running saldo of the account.
  function cellTitle(
    base: string | undefined,
    entryCount: number,
    saldo?: DaySaldo,
    // Issue #992 (D-992-11): the full „8:00 h“ lives in the title; the phone cell shows „8:00“ only.
    worked?: string,
  ): string | undefined {
    const count = multiEntryUi ? entryCountTitle(entryCount) : null;
    return [base, worked, count, daySaldoTitle(saldo)].filter(Boolean).join(" · ") || undefined;
  }

  function openEdit(entry: TimeEntry) {
    editEntry = entry;
    formDate = (entry.date ?? entry.startTime).split("T")[0];
    formStart = format(new Date(entry.startTime), "HH:mm");
    formHasEnd = !!entry.endTime;
    formEnd = entry.endTime ? format(new Date(entry.endTime), "HH:mm") : "17:00";
    formSalonId = entry.salonId ?? "";
    formTravel = false;
    formTravelFrom = entry.salonId ?? "";
    formTravelTo = entry.travelToSalonId ?? "";
    if (entry.breaks && entry.breaks.length > 0) {
      formBreaks = entry.breaks.map((b) => ({
        start: format(new Date(b.startTime), "HH:mm"),
        end: format(new Date(b.endTime), "HH:mm"),
      }));
    } else {
      formBreaks = [];
    }
    formNote = entry.note ?? "";
    formReason = "";
    saveError = "";
    saveErrorLink = null;
    modalOpen = true;
  }

  function closeModal() {
    modalOpen = false;
    editEntry = null;
    deleteConfirmId = "";
  }

  // Quick 260824-cjd: a manager editing ANOTHER employee's entry is a Korrektur
  // and must supply a Begründung; editing their own entry is not (server parity —
  // putIsCorrectionByManager in apps/api/src/contexts/time-tracking/api/time-entries.ts).
  let isCorrectionEdit = $derived(
    !!editEntry && selectedEmployeeId !== ($authStore.user?.employeeId ?? null),
  );

  // The Modal primitive owns Escape/backdrop dismiss: it flips modalOpen to
  // false directly via bind:open. Mirror closeModal's state reset so those
  // paths leave the page in the same state as the explicit Abbrechen button.
  $effect(() => {
    if (!modalOpen) {
      editEntry = null;
      deleteConfirmId = "";
    }
  });

  // ── Issue #80 — day breaks and acknowledgements of a multi-entry day ────────
  // The panel hands over "HH:MM" on the check's day; the ISO conversion mirrors saveEntry() so a
  // day break lines up with the entries it sits between. API errors are rethrown on purpose: the
  // panel / ReasonDialog shows the German message.
  async function addDayBreak(date: string, slot: { startLocal: string; endLocal: string }) {
    if (!selectedEmployeeId) return;
    await api.post("/day-breaks", {
      employeeId: selectedEmployeeId,
      date,
      startTime: new Date(`${date}T${slot.startLocal}:00`).toISOString(),
      endTime: new Date(`${date}T${slot.endLocal}:00`).toISOString(),
    });
    await loadAll();
  }

  // Issue #660: an offer of the day check is recorded for the person the check was loaded for
  // (`dayChecksEmployeeId`, WR-03 - not the current selection) exactly like the form's trip create
  // (body of the form, `source: "CORRECTION"`). Right before writing, that person's day check is
  // loaded again and the trip is posted only if the identical offer is still served (WR-01); the
  // server then re-decides the write.
  // A refusal is the server's own text (a toast survives the reload, the panel may not), and the
  // reload shows the new day state either way.
  async function recordTravelOffer(date: string, offer: DayCheckTravelOffer) {
    const checkedEmployeeId = dayChecksEmployeeId;
    if (!checkedEmployeeId) return;
    try {
      const outcome = await postOfferIfStillServed({
        date,
        offer,
        multiEntryUi,
        loadChecks: () =>
          api
            .get<DayChecksResponse>(
              `/day-breaks/checks?employeeId=${checkedEmployeeId}&from=${date}&to=${date}`,
            )
            .catch(() => null),
        post: () =>
          api.post<{ warnings?: unknown }>("/time-entries", {
            ...travelOfferPayload(date, offer),
            employeeId: checkedEmployeeId,
            source: "CORRECTION",
          }),
      });
      if (!outcome.posted) {
        toasts.warning(TRAVEL_TEXTS.offerStale);
      } else {
        const notice = breakFindingSaveNotice(outcome.result?.warnings);
        if (notice) toasts.warning(notice);
      }
    } catch (e: unknown) {
      toasts.error(travelOfferErrorText(e));
    } finally {
      await loadAll();
    }
  }

  async function deleteDayBreak(id: string, reason: string) {
    await api.delete(`/day-breaks/${id}`, { reason });
    await loadAll();
  }

  async function acknowledgeDay(date: string, reason: string) {
    if (!selectedEmployeeId) return;
    await api.post("/day-breaks/acks", { employeeId: selectedEmployeeId, date, reason });
    await loadAll();
  }

  async function revokeDayAck(ackId: string, reason: string) {
    await api.delete(`/day-breaks/acks/${ackId}`, { reason });
    await loadAll();
  }

  // Converts the current form state (date, times, break slots) into the ISO fields
  // POST/PUT /time-entries expects. Shared by the save and the findings preview, so the preview
  // evaluates exactly what the save would send.
  function buildManualEntryFields() {
    const startISO = new Date(`${formDate}T${formStart}:00`).toISOString();
    const endISO = formHasEnd ? new Date(`${formDate}T${formEnd}:00`).toISOString() : null;
    const breaksPayload = formBreaks
      .filter((b) => b.start && b.end)
      .map((b) => ({
        startTime: new Date(`${formDate}T${b.start}:00`).toISOString(),
        endTime: new Date(`${formDate}T${b.end}:00`).toISOString(),
      }));
    return { startISO, endISO, breaksPayload };
  }

  async function saveEntry() {
    // Quick 260824-cjd: Begründung ist Pflicht bei einer echten Korrektur —
    // client-seitig vorab geblockt, mit derselben Fehlermeldung wie die API.
    if (isCorrectionEdit && !formReason.trim()) {
      saveError = "Begründung ist erforderlich (revisionssicherheitspflichtig).";
      saveErrorLink = null;
      return;
    }
    if (travelActive && (!formTravelFrom || !formTravelTo)) {
      saveError = TRAVEL_TEXTS.salonsRequired;
      saveErrorLink = null;
      return;
    }
    saving = true;
    saveError = "";
    saveErrorLink = null;
    const { startISO, endISO, breaksPayload } = buildManualEntryFields();
    try {
      // Issue #80 (D-09a) + Issue #511 D-10: the response carries the server's break findings;
      // the notice below names the cross-salon and the Satz-2/3 ones. The form's own findings
      // came from the preview before saving.
      let saved: { warnings?: unknown } | undefined;
      if (travelActive && endISO) {
        // Issue #92 (D-06): a trip carries no break, no share and no kind - the server derives the
        // kind from the arrival salon and answers every refusal in German, shown below.
        const travel = travelPayload({
          date: formDate,
          start: startISO,
          end: endISO,
          fromSalonId: formTravelFrom,
          toSalonId: formTravelTo,
          note: formNote || null,
        });
        saved = editEntry
          ? await api.put<{ warnings?: unknown }>(`/time-entries/${editEntry.id}`, {
              ...travel,
              source: "CORRECTION",
              ...(isCorrectionEdit ? { reason: formReason.trim() } : {}),
            })
          : await api.post<{ warnings?: unknown }>("/time-entries", {
              ...travel,
              employeeId: selectedEmployeeId,
              source: "CORRECTION",
            });
      } else if (editEntry) {
        saved = await api.put<{ warnings?: unknown }>(`/time-entries/${editEntry.id}`, {
          date: formDate,
          startTime: startISO,
          endTime: endISO,
          breakMinutes: formBreakTotal,
          breaks: breaksPayload,
          note: formNote || null,
          source: "CORRECTION",
          salonId: formSalonPayload,
          ...(isCorrectionEdit ? { reason: formReason.trim() } : {}),
        });
      } else {
        saved = await api.post<{ warnings?: unknown }>("/time-entries", {
          date: formDate,
          startTime: startISO,
          endTime: endISO,
          breakMinutes: formBreakTotal,
          breaks: breaksPayload,
          note: formNote || null,
          employeeId: selectedEmployeeId,
          source: "CORRECTION",
          salonId: formSalonPayload,
        });
      }
      closeModal();
      await loadAll();
      const breakFindingNotice = breakFindingSaveNotice(saved?.warnings);
      if (breakFindingNotice) toasts.warning(breakFindingNotice);
    } catch (e: unknown) {
      // Issue #1020: a 403 is not always a lock — see teamEntryWriteError.
      const shown = teamEntryWriteError(e, {
        ownEntry:
          !!selectedEmployeeId && selectedEmployeeId === ($authStore.user?.employeeId ?? null),
        day: formDate || null,
        fallback: "Fehler beim Speichern",
      });
      saveError = shown.text;
      saveErrorLink = shown.link;
    } finally {
      saving = false;
    }
  }

  function openDeleteDialog(id: string) {
    deleteConfirmId = id;
    deleteDialogOpen = true;
  }

  async function confirmDeleteDialog(reason: string) {
    if (!deleteConfirmId) return;
    await deleteEntry(deleteConfirmId, reason);
  }

  async function deleteEntry(id: string, reason: string) {
    try {
      await api.delete(`/time-entries/${id}`, { reason });
      deleteConfirmId = "";
      await loadAll();
    } catch (e: unknown) {
      const row = entries.find((x) => x.id === id);
      const shown = teamEntryWriteError(e, {
        ownEntry:
          !!selectedEmployeeId && selectedEmployeeId === ($authStore.user?.employeeId ?? null),
        day: row ? entryDay(row, $tenantFeatures.timezone) : null,
        fallback: "Fehler beim Löschen",
      });
      error = shown.text;
      errorLink = shown.link;
    }
  }

  async function revalidateEntry(id: string) {
    try {
      await api.patch(`/time-entries/${id}/revalidate`, {});
      await loadAll();
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : "Fehler beim Revalidieren";
    }
  }

  // D-06: Derive lock state from entry data already loaded — no extra API request
  let monthIsLocked = $derived(entries.some((e) => e.isLocked === true));

  // ── Reaktive Ableitungen ───────────────────────────────────────────────────
  let isMonthlyHours = $derived(schedule?.type === "MONTHLY_HOURS");
  // Issue #164 — mirrors /time-entries' isNoDailyTarget for the two types the SERVER
  // treats as gap-free (find-missing-workdays.ts:134, presence.ts:72, overtime.ts:82,
  // attendance-checker.ts:648, auto-close-month.ts:310): a per-day +/- is meaningless
  // when the contract fixes only a weekly or monthly total. SHIFT_BASED is deliberately
  // NOT included here, unlike on /time-entries: this page sources its SHIFT_BASED Soll
  // from real roster minutes, where a daily diff does mean something. That residual
  // difference between the two pages is out of scope for #164 and left visible.
  let isNoDailyTarget = $derived(
    schedule?.type === "MONTHLY_HOURS" || schedule?.type === "FLEXTIME",
  );
  let monthlyTarget = $derived(
    isMonthlyHours && schedule?.monthlyHours ? Number(schedule.monthlyHours) * 60 : 0,
  );
  let hasMonthlyTarget = $derived(isMonthlyHours && monthlyTarget > 0);
  // Issue #433 (D-11) — the MONTHLY_HOURS header SOLL is the server's monthSollMinutes, the SAME
  // saldo-core value Monatsabschluss, the dashboard and the monthly report use (plan 05). A
  // reduction-free month still equals the budget exactly; the browser computes no month Soll of
  // its own any more. The `?? 0` is unreachable in practice: a response missing
  // monthSollMinutes routes into saldoFetchFailed above instead of being rendered as a
  // fabricated 0 (see the month-saldo fetch in loadAll).
  let monthlyBudgetSoll = $derived(hasMonthlyTarget ? (monthSaldo?.monthSollMinutes ?? 0) : 0);
  // Worked + Expected up to cutoff: always YESTERDAY, never today. Today's entry may still be
  // open, or it may be closed only because of a lunch-break clock-out that the clock resolver
  // reopens on the next clock-in (commit 446d4bb6) — there is no reliable signal that today is
  // actually "done". This is the same cutoff as the server's live saldo
  // (overtime-balance.ts / month-saldo.ts, issue #438).
  //
  // Phase 125 (issue #125) — one predicate, two outputs. `totalWorked` (the card's Ist in every
  // non-SHIFT branch) and `workedEntryDays` (its "N Arbeitstage bisher" in those same branches)
  // are read off the SAME filtered list, so they cannot disagree the way issue #125 reported.
  // SHIFT_BASED uses neither: there both numbers come from GET /overtime/month-saldo
  // (monthSaldo.workedMinutes / monthSaldo.workedDays). `entries` is already scoped to the
  // displayed month by fromDate/toDate.
  const netEntryMinutes = (e: TimeEntry): number =>
    Math.floor((new Date(e.endTime!).getTime() - new Date(e.startTime).getTime()) / 60000) -
    (e.breakMinutes ?? 0);

  let entriesToDate = $derived(
    entries.filter((e) => {
      if (!e.endTime || e.isInvalid) return false;
      const d = (e.date ?? e.startTime).split("T")[0];
      return d < todayStr;
    }),
  );
  let totalWorked = $derived(entriesToDate.reduce((s, e) => s + netEntryMinutes(e), 0));
  let workedEntryDays = $derived(
    new Set(
      entriesToDate
        .filter((e) => netEntryMinutes(e) > 0)
        .map((e) => (e.date ?? e.startTime).split("T")[0]),
    ).size,
  );
  let totalExpected = $derived(
    calendarDays
      .filter((d) => {
        if (!d.isCurrentMonth || d.isFuture) return false;
        return !d.isToday;
      })
      .reduce((s, d) => s + d.expectedMin, 0),
  );
  // Declared after totalWorked/totalExpected, which it reads.
  let mBalance = $derived(
    // For MONTHLY_HOURS with a monthly target: compare worked against the server's month Soll
    // (monthlyBudgetSoll), "budget remaining" semantic, full-month.
    // For FIXED_SCHEDULE / FLEXTIME and no-target MONTHLY_HOURS: keep the up-to-today accrual.
    hasMonthlyTarget ? totalWorked - monthlyBudgetSoll : totalWorked - totalExpected,
  );
  // §615 SHIFT_BASED: Soll (bisher) + Monat-Saldo come from the §615 core (monthSaldo).
  // Non-SHIFT: fall through to the existing derived values (totalExpected, mBalance).
  let isShiftBased = $derived(schedule?.type === "SHIFT_BASED");

  // Quick 260820-fkz — replaces monthBarStats (formatted MonthBar tiles) with raw minutes for
  // MonatSaldoCard/SollIstBar, mirroring /time-entries (commit d88cdcba, quick 260820-elk).
  // Same branch structure and source expressions as the deleted monthBarStats derivation; only
  // the output shape changes (minutes, not formatted strings — no saldo recomputation, just
  // selecting among already-computed values). Two deliberate omissions vs. /time-entries (D-04):
  //  - no `extraNote` — this page has no FLEXTIME "Woche Saldo" tile (verified: `weekExpectedMin`/
  //    `weekWorkedMin`/"Woche" do not occur here), so there is nothing to carry.
  //  - `rosterIncomplete` is added where the figures are worded (zeitenKpis, Issue #853).
  type MonthMetrics = {
    sollToDateMin: number;
    istMin: number;
    saldoMin: number | null; // null → no schedule / no Soll target
    sollLabel: string;
    closed: boolean;
    // Phase 125 (issue #125) — the "N Arbeitstage bisher" count, deliberately a MonthMetrics field
    // so it is produced by the SAME branch as `istMin` above it and can never be sourced from
    // somewhere else. `null` = this branch has no count and the card must print none.
    workdaysSoFar: number | null;

    // True only for a MONTHLY_HOURS contract without monthly hours; drives the card's no-Soll
    // rendering (month Ist as the main figure instead of a saldo).
    noSollTarget: boolean;
  };
  let monthMetrics: MonthMetrics = $derived.by(() => {
    // Issue #85 (Phase 76b note) — a refused read hides its cards instead of erroring. The Ist
    // shown comes from the entries the server returned for the caller's scope; no Soll and no
    // saldo are computed or implied.
    if (saldoDenied) {
      return istOnlyMonthMetrics({ istMin: totalWorked, workdaysSoFar: workedEntryDays });
    }

    if (!schedule) {
      return {
        sollToDateMin: 0,
        istMin: 0,
        saldoMin: null,
        sollLabel: "Soll (bisher)",
        closed: false,
        workdaysSoFar: null,
        noSollTarget: false,
      };
    }

    if (isShiftBased && monthSaldo) {
      // §615 header — ALL figures from the SAME computeMonthSaldo to-date result so they
      // always reconcile (Monat-Saldo = Ist − Soll (bisher)) and match the day cells.
      return {
        sollToDateMin: monthSaldo.expectedMinutes,
        istMin: monthSaldo.workedMinutes,
        saldoMin: monthSaldo.balanceMinutes,
        sollLabel: "Soll (bisher)",
        closed: monthSaldo.closed,
        workdaysSoFar: monthSaldo.workedDays ?? null,
        noSollTarget: false,
      };
    }

    if (isMonthlyHours && !hasMonthlyTarget) {
      // Genuinely no Soll to compare against — the real-world source of SollIstBar's
      // sollToDateMin===0 branch. CLAUDE.md: MONTHLY_HOURS with monthlyHours null/0 is pure
      // time tracking with NO Soll — do NOT compute a ratio here.
      return {
        sollToDateMin: 0,
        istMin: totalWorked,
        saldoMin: null,
        sollLabel: "Soll",
        closed: false,
        workdaysSoFar: workedEntryDays,
        noSollTarget: true,
      };
    }

    if (hasMonthlyTarget) {
      return {
        sollToDateMin: monthlyBudgetSoll,
        istMin: totalWorked,
        saldoMin: mBalance,
        sollLabel: "Soll",
        closed: false,
        workdaysSoFar: workedEntryDays,
        noSollTarget: false,
      };
    }

    // FIXED_*/FLEXTIME — Issue #986: the account's own to-date header (the same computeMonthSaldo
    // result as the day shares), so a Berufsschule credit is in the Ist and the month saldo equals
    // the account's and the report's. The browser sum below is only reached when the account
    // answer is missing, which saldoFetchFailed already routes into the card's error branch.
    if (monthSaldo) {
      return {
        sollToDateMin: monthSaldo.expectedMinutes,
        istMin: monthSaldo.workedMinutes,
        saldoMin: monthSaldo.balanceMinutes,
        sollLabel: "Soll (bisher)",
        closed: monthSaldo.closed,
        workdaysSoFar: monthSaldo.workedDays ?? null,
        noSollTarget: false,
      };
    }
    return {
      sollToDateMin: totalExpected,
      istMin: totalWorked,
      saldoMin: mBalance,
      sollLabel: "Soll (bisher)",
      closed: false,
      workdaysSoFar: workedEntryDays,
      noSollTarget: false,
    };
  });
  let runningCount = $derived(entries.filter((e) => !e.endTime).length);
  // Issue #511 D-18 — the modal's findings are the server's answer for the PROPOSED entry together
  // with the day's other entries (POST /day-breaks/preview, debounced, a stale answer is dropped).
  // A failed preview leaves the list empty and never blocks saving. A hint (position of a break
  // not recorded) is shown as a muted note by the template, never as a finding.
  let modalWarnings = $state<DayCheckWarning[]>([]);
  // The automatic break a NEW entry without any break gets on save; the preview already counted it,
  // so the form says so instead of reporting a missing break.
  let modalAutoBreak = $state<DayPreviewAutoBreak | null>(null);
  let modalFindings = $derived(modalWarnings.filter((w) => !w.hint));
  let modalHints = $derived(modalWarnings.filter((w) => w.hint));
  const previewRunner = createDayPreviewRunner((path, body) =>
    api.post<DayPreviewResponse>(path, body),
  );
  onDestroy(() => previewRunner.dispose());
  $effect(() => {
    // Issue #92: a trip has no break to evaluate; the server judges it on save.
    const active =
      arbzgEnabled && modalOpen && formHasEnd && !!formStart && !!formEnd && !travelActive;
    let body: DayPreviewRequest | null = null;
    if (active && selectedEmployeeId && formDate) {
      try {
        const { startISO, endISO, breaksPayload } = buildManualEntryFields();
        body = buildDayPreviewRequest({
          employeeId: selectedEmployeeId,
          date: formDate,
          entryId: editEntry?.id,
          startISO,
          endISO,
          breaks: breaksPayload,
          breakMinutes: formBreakTotal,
          salonId: formSalonPayload,
        });
      } catch {
        // A half-typed time cannot be converted; nothing to evaluate yet.
        body = null;
      }
    }
    previewRunner.request(body, (warnings, autoBreakApplied) => {
      modalWarnings = warnings;
      modalAutoBreak = autoBreakApplied;
    });
  });
  // Calendar and list markers: dateStr → warnings[]. The server decides which days carry a
  // finding (Issue #80 day checks + Issue #511 D-18); the browser only maps the answer.
  let arbzgDayMap = $derived(
    arbzgEnabled ? dayChecksToArbzgMap(dayChecks) : new Map<string, DayWarning[]>(),
  );

  // Issue #853 (owner review, prototype „Zeiten“): the Kennzahlen Gearbeitet, Monatssaldo, Gesamtsaldo
  // (Issue #1029, from GET /overtime/:id), Pausen and Status, worded by lib/me/zeiten-kpis.ts from the page's MonthMetrics (#125, #433, #495) - the
  // same module Ich › Zeiten uses, so both pages say the same thing. Breaks are the stored ones of the
  // counted entries (the set of the Ist); findings come from the server's day check (#80/#511).
  // A refused saldo read (#85) shows the Ist only and says who sees the rest.
  let breakMinutesToDate = $derived(entriesToDate.reduce((s, e) => s + (e.breakMinutes ?? 0), 0));
  let zeitenItems = $derived(
    zeitenKpis({
      // The server sends `rosterIncomplete` for a SHIFT_BASED open month only (#97-05); never a
      // fabricated flag.
      month: { ...monthMetrics, rosterIncomplete: monthSaldo?.rosterIncomplete ?? false },
      locked: monthIsLocked || monthMetrics.closed,
      breakMinutes: breakMinutesToDate,
      findingDays: arbzgEnabled ? arbzgDayMap.size : null,
      runningCount,
      saldoWithheld: saldoDenied,
      // Issue #1029: the Gesamtsaldo is the GET /overtime/:id total this page already loads, never a
      // second computation (#681/#682); withheld exactly when that read was refused (#85).
      account:
        overtimeTotalHours === null
          ? null
          : {
              balanceHours: overtimeTotalHours,
              unconfirmedMonths: overtimeUnconfirmedMonths,
              hasClosedMonth: overtimeHasClosedMonth,
              stand: standGesternText(todayAnchor),
            },
      accountWithheld: overtimeDenied,
    }),
  );
  let zeitenMonthStatus = $derived(zeitenStatus(monthIsLocked || monthMetrics.closed));

  // Legend is derived from what the displayed month actually contains, and split by the
  // three encoding channels — quick task 260820-1i7. Colour = Soll status (left edge),
  // surface = Abwesenheit, mark = Hinweis.
  // The swatch colour of an absence entry comes from the one leave-colour mapping and reaches the
  // CSS as the custom property `--leg-fill` (#840, D-840-12).
  const LEGEND_ABSENCE = [
    { code: "VACATION", label: "Urlaub" },
    { code: "SICK", label: "Krank" },
    { code: "SICK_CHILD", label: "Kinderkrank" },
    { code: "SPECIAL", label: "Sonderurlaub" },
    { code: "OVERTIME_COMP", label: "Freizeitausgl." },
  ] as const;

  let legendGroups = $derived.by(() => {
    const days = calendarDays.filter((d) => d.isCurrentMonth);
    const soll: { cls: string; label: string; fill?: string }[] = [];
    if (days.some((d) => d.status === "ok" || d.status === "today-ok"))
      soll.push({ cls: "leg-ok", label: "Soll erfüllt" });
    if (days.some((d) => d.status === "partial" || d.status === "today-partial"))
      soll.push({ cls: "leg-partial", label: "Teilweise" });
    if (days.some((d) => d.status === "missing")) soll.push({ cls: "leg-missing", label: "Fehlt" });
    if (days.some((d) => d.status === "noExpect" || d.status === "today-empty"))
      soll.push({ cls: "leg-noexpect", label: "Kein Soll" });

    const codes = new Set(days.map((d) => d.absenceType).filter(Boolean) as string[]);
    const abwesenheit: { cls: string; label: string; fill?: string }[] = [];
    for (const e of LEGEND_ABSENCE)
      if (codes.has(e.code))
        abwesenheit.push({ cls: "leg-abs", label: e.label, fill: leaveTypeColor(e.code).fill });
    // Absence codes outside the catalogue (e.g. EDUCATION, UNPAID) DO get a cell
    // background from app.css's .cal-abs-* recipes, so they must not stay unexplained.
    if ([...codes].some((c) => !LEGEND_ABSENCE.some((e) => e.code === c)))
      abwesenheit.push({ cls: "leg-abs", label: OTHER_ABSENCE_LABEL, fill: FALLBACK.fill });
    if (days.some((d) => d.isVocationalSchool))
      abwesenheit.push({ cls: "leg-abs-vocational_school", label: "Berufsschule" });

    const hinweise: { cls: string; label: string; fill?: string }[] = [];
    if (days.some((d) => arbzgDayMap.has(d.dateStr)))
      hinweise.push({ cls: "leg-arbzg", label: "ArbZG-Hinweis" });

    return { soll, abwesenheit, hinweise };
  });

  // Issue #853 (owner review, prototype „Zeiten“): the list is ONE row per day - Tag, Salon, Zeiten,
  // Pause, Netto, Soll, Differenz and „Öffnen“ - built by lib/team/zeiten-day-rows.ts from the loaded
  // entries and the page's per-day Soll. Source, note and the edit/delete actions of each entry live
  // in the day sheet. Soll and Differenz appear only where the page has a per-day Soll to show: not
  // for a refused saldo read (#85), not without a contract, and not for a weekly or monthly total
  // (#164, isNoDailyTarget).
  let sollVisible = $derived(!saldoDenied && !!schedule && !isNoDailyTarget);
  let calendarDayByDate = $derived(new Map(calendarDays.map((d) => [d.dateStr, d])));
  let dayRows = $derived(
    teamDayRows({
      // The salons of the day by name (a trip counts with its departure salon); the trip route
      // itself is shown in the day sheet, inside the #64 gate.
      entries: entries.map((e) => ({ ...e, salonLabel: e.salonName ?? null })),
      vocationalSchoolDays: bsAbsences.map((b) => b.date),
      // Issue #1029: the Differenz of a row is the server's day step, never Ist minus Soll here.
      dayInfo: (day) => {
        const info = calendarDayByDate.get(day);
        return info ? { ...info, diffMin: daySaldo.get(day)?.diffMin ?? null } : undefined;
      },
      sollVisible,
      findingDays: new Set(arbzgDayMap.keys()),
      missingDays: serverMissing ?? undefined,
    }),
  );
  const listColumns = $derived<DataTableColumn[]>([
    { key: "day", label: "Tag", primary: true },
    ...(multiEntryUi ? [{ key: "salon", label: "Salon" }] : []),
    { key: "times", label: "Zeiten" },
    { key: "pause", label: "Pause", align: "end" as const },
    { key: "net", label: "Netto", align: "end" as const },
    ...(sollVisible ? [{ key: "soll", label: "Soll", align: "end" as const }] : []),
    // Issue #1029: ONE Differenz column for every contract model - the server's day step
    // (`balanceMinutes`), also for SHIFT_BASED; the running saldo is not a column of this list.
    ...(sollVisible
      ? [
          {
            key: "diff",
            label: "Differenz",
            align: "end" as const,
            title: DAY_DIFF_TITLE,
          },
        ]
      : []),
    { key: "open", label: "", align: "end" as const },
  ]);
  // Without a Differenz column the day's status chip (running, invalid) sits next to its times.
  let stateInTimes = $derived(!listColumns.some((c) => c.key === "diff"));
  // The day a deep link or a calendar cell pointed at (Issue #70) is highlighted; nothing else is
  // tinted - a running or invalid day says so in its chip, never through a coloured row.
  function dayRowTone(row: TeamDayRow): DataTableRowTone | undefined {
    return multiEntryUi && row.day === selectedDate ? "highlight" : undefined;
  }

  // ── Day sheet (prototype „Tagesdialog“, #851 DaySheet) ─────────────────────
  let daySheetOpen = $state(false);
  let daySheetDay = $state<string | null>(null);
  function openDaySheet(day: string) {
    daySheetDay = day;
    selectedDate = day;
    daySheetOpen = true;
    syncAddress();
  }
  let daySheetEntries = $derived(
    daySheetDay
      ? rowsOfDay(daySheetDay)
          .slice()
          .sort((x, y) => x.startTime.localeCompare(y.startTime))
      : [],
  );
  // Issue #1029: the day check of the opened day; its break panel lives in the day view.
  let daySheetCheck = $derived(
    daySheetDay ? (dayChecks.find((c) => c.date === daySheetDay) ?? null) : null,
  );
  let daySheetPanel = $derived(daySheetCheck !== null && dayBreakPanelVisible(daySheetCheck));
  let daySheetInfo = $derived(daySheetDay ? calendarDayByDate.get(daySheetDay) : undefined);
  let daySheetLocked = $derived(daySheetEntries.some((e) => e.isLocked === true));
  let daySheetRows = $derived<DaySheetEntry[]>(
    daySheetEntries.map((e) => ({
      id: e.id,
      from: fmtTime(e.startTime),
      to: e.endTime ? fmtTime(e.endTime) : "läuft",
      pause: pauseLabel([e]),
      net: e.endTime ? slotNet(e) : "–",
      source: sourceLabel(e.source),
      note: e.isInvalid && e.invalidReason ? e.invalidReason : e.note,
      testId: `team-time-entry-row-${e.id}`,
    })),
  );
  let daySheetIst = $derived(
    daySheetEntries
      .filter((e) => e.endTime && !e.isInvalid)
      .reduce((sum, e) => sum + netEntryMinutes(e), 0),
  );
  let daySheetPrimary = $derived.by(() => {
    if (!daySheetDay || daySheetLocked || daySheetInfo?.isFuture) return null;
    // An existing entry is edited from its own row; the primary action only ever adds one.
    return addActionForDay(rowsOfDay(daySheetDay), multiEntryUi).kind === "edit"
      ? null
      : rowsOfDay(daySheetDay).length > 0
        ? "Weitere Zeit eintragen"
        : "Zeit eintragen";
  });

  // Phase 116 (issue #119) — the ONE answer to "what does the list render right now".
  // `hasEmployeeLink` is always true where this renders (the markup sits inside
  // {#if selectedEmployee}), but it is passed honestly rather than hard-coded so the
  // "no-employee" arm survives if that wrapper ever moves.
  let listState = $derived(
    resolveMonthListState({
      loading,
      hasEmployeeLink: selectedEmployeeId !== null,
      rowCount: dayRows.length,
    }),
  );
  let saldoCardState = $derived(
    resolveSaldoCardState({
      loading,
      hasEmployeeLink: selectedEmployeeId !== null,
      fetchFailed: saldoFetchFailed,
      pageError: !!error,
    }),
  );
</script>

<svelte:head><title>{pageLabel("/team/time-entries")} – Clokr</title></svelte:head>
<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && modalOpen) closeModal();
  }}
/>

<PageHead
  title={pageLabel("/team/time-entries")}
  hint="Arbeitszeiten deines Teams, pro Person oder für einen ganzen Salon."
>
  {#snippet actions()}
    {#if teamMode === "person" && selectedEmployee}
      <!-- quick 260820-fkz — the account total lives outside the page head, as the Gesamtsaldo
           Kennzahl of the figures strip below (Issue #853, D-853-18; Issue #1029). -->
      <button class="btn btn-primary" onclick={() => openAdd()}>
        <span aria-hidden="true">＋</span> Zeit eintragen
      </button>
    {/if}
  {/snippet}
</PageHead>

<!-- ── Ansicht: Person oder Salon (Issue #85, D-09) ─────────────────────
     The two views are the tabs of the Seitenkopf (Issue #853, D-853-10). The content of the
     active view is the tab panel the active tab controls (aria-controls), so a screen reader finds
     the toolbar, the figures, the calendar and the lists inside the tabpanel; the inactive tab's
     panel stays empty and hidden, so nothing is rendered twice. -->
<PageTabs
  tabs={viewTabs}
  tab={teamMode}
  onTabChange={(value) => setTeamMode(value === "salon" ? "salon" : "person")}
  tabsLabel="Ansicht"
>
  {#snippet panel(value)}
    {#if value === teamMode}
      {@render viewBody()}
    {/if}
  {/snippet}
</PageTabs>

<!-- ── Period control (quick 260820-fkz, Issue #853 D-853-18) ──────────
     Bare month bar, no stats and no eyebrow (the month figures live in the figures of the person
     view). Rendered once per view, in the toolbar row under the tabs. -->
{#snippet monthNavBar()}
  <MonthBar
    date={calMonth}
    onPrev={() => gotoMonth(-1)}
    onNext={() => gotoMonth(1)}
    onToday={gotoToday}
    onSelectMonth={gotoMonthYear}
  />
{/snippet}

{#snippet viewBody()}
  {#if teamMode === "person"}
    <SalonScopeLabel label={scopeLabel} rejected={listRejected} />
    <!-- Prototype .toolbar2: person picker (once a person is chosen; before that it sits in the
       empty state), the month and the Kalender/Liste segment. -->
    <div class="te-controls-row">
      {#if selectedEmployee}
        <div class="employee-selector">
          <PersonPicker
            items={pickerItems}
            value={selectedEmployeeId ?? ""}
            onValueChange={pickEmployee}
          />
        </div>
      {/if}
      {@render monthNavBar()}
      {#if selectedEmployee}
        <div class="te-view-segment">
          <SegmentedControl
            options={VIEW_OPTIONS}
            value={teView}
            onchange={(value) => void selectView(value)}
            ariaLabel="Darstellung"
            name="te-view"
            size="sm"
          />
        </div>
      {/if}
    </div>
  {/if}

  {#if teamMode === "salon"}
    {#key salonViewKey}
      <SalonHoursView
        status={salonViewStatus}
        data={salonHoursData}
        period={salonPeriod}
        {todayStr}
        salonName={salonViewSalonName}
        errorMessage={salonViewError || undefined}
        clickableIds={salonClickableIds}
        onCellOpen={(employeeId, day) => void openPersonDay(employeeId, day)}
        aufgabenHref={mayOpenTeamPage("/team/aufgaben", $authStore.user)
          ? "/team/aufgaben?typ=ausstempeln"
          : null}
        canExport={salonHoursRights($authStore.user).export}
        onExport={() => void exportSalonHours()}
        onPeriodChange={(next) => (salonPeriod = next)}
        onRetry={() => void loadSalonView(salonViewSalonId, salonPeriod)}
      />
    {/key}
  {:else if selectedEmployee}
    {#if error}
      <div class="alert alert-error" role="alert">
        <span>⚠</span><span
          >{error}
          {#if errorLink}<a href={errorLink.href} data-testid="team-entry-error-link"
              >{errorLink.label}</a
            >{/if}</span
        >
      </div>
    {/if}

    <!-- Figures strip (Issue #853, owner review; prototype #p-zeiten stats): Gearbeitet, Monatssaldo,
       Gesamtsaldo (Issue #1029), Pausen and Status of the chosen person, worded by lib/me/zeiten-kpis.ts like Ich › Zeiten.
       Rendered ONLY with an employee selected (D-01). -->
    <div class="te-figures">
      {#if saldoCardState === "loading"}
        <Skeleton shape="block" height="6.5rem" />
      {:else if saldoCardState === "error"}
        <ErrorState message="Werte konnten nicht geladen werden." hint="" onRetry={loadAll} />
      {:else}
        <KpiStrip items={zeitenItems} ariaLabel="Monat in Zahlen">
          {#snippet extra()}
            <div class="te-status" data-testid="zeiten-kpi-status">
              <span class="te-status-label">Status</span>
              <span class="te-status-value"
                ><Chip tone={zeitenMonthStatus.tone}>{zeitenMonthStatus.label}</Chip></span
              >
              <span class="te-status-note">{zeitenMonthStatus.explanation}</span>
            </div>
          {/snippet}
        </KpiStrip>
      {/if}
    </div>

    <!-- Issue #1029: ONE slim line names the days with a day-check result (the server's open break
       findings, and every other day with something to show); the calendar marks them, each day opens
       its day view, where the details and the acknowledgement live (Issue #80 panel). -->
    <DayCheckLine checks={dayChecks} onOpenDay={openDaySheet} onMore={() => selectView("list")} />

    <!-- ── Kalender ─────────────────────────────────────────────────────────── -->
    {#if teView === "calendar"}
      <div class="cal-section card card-animate">
        <!-- Wochentage-Header -->
        <div class="cal-grid cal-header-row">
          {#each ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as d (d)}
            <div class="cal-dow">{d}</div>
          {/each}
        </div>

        <!-- Tage -->
        {#if loading}
          <div class="cal-grid">
            {#each Array(35) as _, i (i)}<div class="cal-cell skeleton"></div>{/each}
          </div>
        {:else}
          <div class="cal-grid">
            {#each calendarDays as day (day.dateStr)}
              {@const baseTitle = day.isBeforeHire
                ? "Vor Eintrittsdatum"
                : day.isHoliday
                  ? day.holidayName
                  : day.absenceType
                    ? calendarAbsenceLabel(day.absenceType) +
                      (day.absenceHalf ? " (halber Tag)" : "")
                    : day.isVocationalSchoolNoLeave
                      ? "Berufsschule – kein Urlaub"
                      : day.isVocationalSchool
                        ? "Berufsschule"
                        : undefined}
              {@const ds = daySaldo.get(day.dateStr)}
              <button
                type="button"
                data-date={day.dateStr}
                class="cal-cell cal-cell--{day.status}{day.absenceType && !day.isWeekend
                  ? ' cal-abs cal-abs-' + day.absenceType.toLowerCase()
                  : (day.isVocationalSchool || day.isVocationalSchoolNoLeave) &&
                      !day.absenceType &&
                      !day.isHoliday
                    ? ' cal-abs cal-abs-vocational_school'
                    : ''}"
                class:cal-other={!day.isCurrentMonth}
                class:cal-current={day.isCurrentMonth}
                class:cal-today={day.isToday}
                class:cal-weekend={day.isWeekend}
                class:cal-holiday={day.isHoliday && day.isCurrentMonth}
                class:cal-selected={day.dateStr === selectedDate && day.isCurrentMonth}
                class:cal-cell--disabled={day.isBeforeHire && day.isCurrentMonth}
                disabled={day.isBeforeHire || !day.isCurrentMonth}
                title={cellTitle(
                  baseTitle,
                  day.entryCount,
                  ds,
                  day.isCurrentMonth && day.hasEntries && !day.isBeforeHire
                    ? `${fmtMin(day.workedMin)} h`
                    : undefined,
                )}
                onclick={() => onCellClick(day.dateStr)}
              >
                <span class="cal-day-num">{day.dayNum}</span>
                {#if day.isCurrentMonth && arbzgDayMap.has(day.dateStr)}
                  {@const arbzgWarnings = arbzgDayMap.get(day.dateStr)!}
                  <span
                    class="cal-arbzg-mark"
                    title={arbzgWarnings.map((w) => w.message).join("\n")}
                    aria-label="ArbZG-Hinweis: {arbzgWarnings.map((w) => w.message).join('; ')}"
                  ></span>
                {/if}
                {#if day.isHoliday && day.isCurrentMonth}
                  <span class="cal-holiday-label">{day.holidayName}</span>
                {:else if day.absenceType}
                  <span class="cal-abs-type"
                    >{calendarAbsenceLabel(day.absenceType)}{day.absenceHalf ? " ½" : ""}</span
                  >
                {:else if (day.isVocationalSchool || day.isVocationalSchoolNoLeave) && day.isCurrentMonth}
                  <span class="cal-abs-type">Berufsschule</span>
                {/if}
                {#if day.isBeforeHire}
                  <span class="day-before-hire">—</span>
                {:else if day.isCurrentMonth && day.hasEntries}
                  <span class="day-worked"
                    >{fmtMin(day.workedMin)}<span class="day-unit">&thinsp;h</span></span
                  >
                  <!-- Issue #1029: the day difference is the server's day step of the account
                     (`balanceMinutes`), never a browser subtraction. Where the server states none
                     (today, future, a closed month, withheld day details #86) the cell shows only
                     the hours. -->
                  {#if !isNoDailyTarget && !day.isToday && ds && ds.diffMin !== null}
                    <span class="day-bal {balClass(ds.diffMin)}" data-testid="cal-day-diff"
                      >{dayDiffText(ds.diffMin)}</span
                    >
                  {/if}
                {:else if day.isCurrentMonth && day.status === "missing" && !isNoDailyTarget && ds && ds.diffMin !== null}
                  <!-- Issue #986/#1029: only a past day the account judges as owed shows its day
                     step (the server's figure, a minus); a Berufsschule day is credited. A day the
                     server states no step for (#987, #86) falls through to „Fehlt“ below. -->
                  <span class="day-missing">{dayDiffText(ds.diffMin)}&thinsp;h</span>
                {:else if day.isCurrentMonth && day.status === "missing"}
                  <span class="day-missing">Fehlt</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}

        <!-- Legende -->
        <div class="cal-legend">
          {#if legendGroups.soll.length > 0}
            <div class="leg-group">
              <span class="leg-group-label">Soll-Status</span>
              {#each legendGroups.soll as e (e.label)}<span class="leg {e.cls}">{e.label}</span
                >{/each}
            </div>
          {/if}
          {#if legendGroups.abwesenheit.length > 0}
            <div class="leg-group">
              <span class="leg-group-label">Abwesenheit</span>
              {#each legendGroups.abwesenheit as e (e.label)}<span
                  class="leg {e.cls}"
                  style:--leg-fill={e.fill ? `var(${e.fill})` : undefined}>{e.label}</span
                >{/each}
            </div>
          {/if}
          {#if legendGroups.hinweise.length > 0}
            <div class="leg-group">
              <span class="leg-group-label">Hinweise</span>
              {#each legendGroups.hinweise as e (e.label)}<span class="leg {e.cls}">{e.label}</span
                >{/each}
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- ── Listenansicht ──────────────────────────────────────────────────── -->
    {#if teView === "list"}
      <div class="te-list" data-testid="team-time-entries-list">
        {#if multiEntryUi}
          {#if listState === "rows" && rowsOfDay(selectedDate).length > 0}
            <div class="list-day-bar" data-testid="team-time-entries-list-day-bar">
              <span class="list-day-label"
                >{format(new Date(selectedDate + "T12:00:00"), "EEEE, d. MMMM", {
                  locale: de,
                })}</span
              >
              <button
                class="btn btn-outline btn-sm"
                type="button"
                onclick={() => openAdditionalEntry(selectedDate)}
                data-testid="team-time-entries-add-additional"
                >Weiteren Eintrag an diesem Tag</button
              >
            </div>
          {/if}
        {/if}
        {#if listState === "empty"}
          <EmptyState
            icon="inbox"
            title="Keine Einträge"
            description="Keine Zeiteinträge in diesem Monat."
          />
        {:else}
          <!-- Phase 116 (issue #119, Akzeptanzkriterium 3): while loading there is a skeleton and
             never the empty state. #853 (owner review): one row per day, the prototype's columns; the
             entries of a day, their source and note and their actions are in the day sheet. -->
          <DataTable
            listId="team.zeiten.tage"
            columns={listColumns}
            rows={dayRows}
            rowKey={(row) => row.day}
            rowTestId={(row) => `team-day-row-${row.day}`}
            rowTone={dayRowTone}
            loading={listState === "loading"}
            caption="Tage im Monat"
          >
            {#snippet cell(row, column)}
              {#if column.key === "day"}
                <span class="day-cell"
                  >{row.dayLabel}{#if row.finding}<Chip tone="warn" title="ArbZG-Hinweis"
                      >prüfen</Chip
                    >{/if}</span
                >
              {:else if column.key === "salon"}
                {#if multiEntryUi}{row.salon}{/if}
              {:else if column.key === "times"}
                <span class="times-cell" class:text-muted={row.vocationalSchool}
                  >{row.times}{#if row.state && stateInTimes}<Chip tone={row.state.tone}
                      >{row.state.label}</Chip
                    >{/if}</span
                >
              {:else if column.key === "pause"}
                {row.pause}
              {:else if column.key === "net"}
                {row.net}
              {:else if column.key === "soll"}
                {row.soll ?? "–"}
              {:else if column.key === "diff"}
                {#if row.state}
                  <Chip tone={row.state.tone}>{row.state.label}</Chip>
                {:else if row.diff}
                  <Chip tone={row.diff.tone}>{row.diff.label}</Chip>
                {:else}
                  <span class="text-muted">–</span>
                {/if}
              {:else if column.key === "open" && !row.vocationalSchool}
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  data-testid={`team-day-row-${row.day}-open`}
                  onclick={() => openDaySheet(row.day)}>Öffnen</button
                >
              {/if}
            {/snippet}
          </DataTable>
        {/if}
      </div>
    {/if}
  {:else}
    <!-- S-11 (D-853-10): without a chosen person there is one empty state with the picker as its
       action - never an empty calendar. -->
    <EmptyState
      icon="users"
      title="Wähle eine Person"
      description="Wessen Zeiten möchtest du sehen? Such nach dem Namen oder der Personalnummer."
    >
      {#snippet action()}
        {#if addAfterPick}
          <p class="form-hint" data-testid="team-zeiten-add-hint">
            Wähle eine Person, um ihre Zeit einzutragen.
          </p>
        {/if}
        <div class="employee-selector" bind:this={pickerHost}>
          <PersonPicker
            items={pickerItems}
            value={selectedEmployeeId ?? ""}
            onValueChange={pickEmployee}
          />
        </div>
      {/snippet}
    </EmptyState>
  {/if}
{/snippet}

<!-- The salon cell of an entry in the day sheet: only with salon choice (#64 gate); a trip shows its
     route (#92). -->
{#snippet daySheetSalon(row: DaySheetEntry)}
  {#if multiEntryUi}
    {@const target = daySheetEntries.find((e) => e.id === row.id)}
    {#if target && isTravelRow(target)}<span
        class="badge badge-gray"
        data-testid={`team-time-entry-row-${row.id}-travel-badge`}>{TRAVEL_TEXTS.badge}</span
      >
      <span class="travel-route" data-testid={`team-time-entry-row-${row.id}-travel-route`}
        >{travelRouteLabel(target)}</span
      >{:else}<span data-testid={`team-time-entry-row-${row.id}-salon`}
        >{target?.salonName ?? "—"}</span
      >{/if}
  {/if}
{/snippet}

<!-- Issue #1029 / #80: the break panel of the opened day (totals, findings, gaps, day breaks,
     acknowledge and revoke, travel offers) - the texts come only from the server's day check, and
     acknowledge/revoke are offered only where its mayAcknowledge allows (D-08). -->
{#snippet daySheetDayCheck()}
  {#if daySheetCheck}
    {@const dayCheck = daySheetCheck}
    <DayBreakPanel
      check={dayCheck}
      onAddBreak={(slot) => addDayBreak(dayCheck.date, slot)}
      onDeleteBreak={deleteDayBreak}
      onAcknowledge={(reason) => acknowledgeDay(dayCheck.date, reason)}
      onRevoke={revokeDayAck}
      travelOffers={travelOffersShown(dayCheck, multiEntryUi)}
      onRecordTravel={(offer) => recordTravelOffer(dayCheck.date, offer)}
    />
  {/if}
{/snippet}

<!-- ── Day sheet (Issue #853, owner review; the #851 DaySheet) ───────────────────
     Read first: Soll, Ist and Differenz of the day, its entries with source and note, the findings of
     the server's day check. Edit and delete are per entry; the primary action adds (or, without salon
     choice, edits) the day's entry. A closed month offers nothing to change. -->
{#if daySheetDay}
  <DaySheet
    bind:open={daySheetOpen}
    title={format(new Date(daySheetDay + "T12:00:00"), "EEEE, d. MMMM", { locale: de })}
    subtitle={selectedEmployee
      ? `${selectedEmployee.firstName} ${selectedEmployee.lastName}`
      : undefined}
    sollMin={sollVisible && daySheetInfo && daySheetInfo.expectedMin > 0
      ? daySheetInfo.expectedMin
      : null}
    istMin={daySheetIst}
    diffMin={sollVisible ? (daySaldo.get(daySheetDay)?.diffMin ?? null) : null}
    runningSaldoMin={daySaldo.get(daySheetDay)?.runningMin ?? null}
    entries={daySheetRows}
    findings={daySheetPanel ? [] : (arbzgDayMap.get(daySheetDay) ?? []).map((w) => w.message)}
    dayCheck={daySheetPanel ? daySheetDayCheck : undefined}
    locked={daySheetLocked}
    lockedText="Dieser Monat ist abgeschlossen. Die Einträge bleiben, wie sie sind; eine Korrektur wird als neuer Eintrag im laufenden Monat gebucht."
    future={daySheetInfo?.isFuture ?? false}
    primaryLabel={daySheetPrimary}
    onPrimary={() => {
      if (daySheetDay) openAdd(daySheetDay);
    }}
    entrySalon={multiEntryUi ? daySheetSalon : undefined}
    wide
  >
    {#snippet entryActions(row)}
      {@const target = daySheetEntries.find((e) => e.id === row.id)}
      {#if target && !target.isLocked}
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          data-testid={`team-time-entry-row-${row.id}-edit`}
          onclick={() => {
            daySheetOpen = false;
            openEdit(target);
          }}>Bearbeiten</button
        >
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          data-testid={`team-time-entry-row-${row.id}-delete`}
          onclick={() => {
            daySheetOpen = false;
            openDeleteDialog(target.id);
          }}>Löschen</button
        >
      {/if}
    {/snippet}
  </DaySheet>
{/if}

<!-- ── Modal (Modal primitive — owns backdrop/escape/focus-trap) ────────── -->
<Modal
  bind:open={modalOpen}
  eyebrow={(travelMode === "travel"
    ? TRAVEL_TEXTS.editTitle
    : editEntry
      ? "Eintrag bearbeiten"
      : "Neuer Eintrag") +
    (selectedEmployee ? ` · ${selectedEmployee.firstName} ${selectedEmployee.lastName}` : "")}
  title={formDate
    ? format(new Date(formDate + "T12:00:00"), "EEEE, d. MMMM yyyy", { locale: de })
    : "Zeiteintrag"}
>
  {#if saveError}
    <div class="alert alert-error" role="alert">
      <span>⚠</span><span
        >{saveError}
        {#if saveErrorLink}<a href={saveErrorLink.href} data-testid="team-entry-error-link"
            >{saveErrorLink.label}</a
          >{/if}</span
      >
    </div>
  {/if}
  <div class="form-group">
    <label class="form-label" for="f-date">Datum</label>
    <input id="f-date" type="date" bind:value={formDate} class="form-input" />
  </div>
  {#if multiEntryUi}
    {#if travelMode === "offer"}
      <div class="form-group">
        <label class="travel-switch">
          <input
            type="checkbox"
            bind:checked={formTravel}
            onchange={(e) => {
              // A trip always has an end.
              if (e.currentTarget.checked) formHasEnd = true;
            }}
            data-testid="team-time-entry-modal-travel-switch"
          />
          <span>{TRAVEL_TEXTS.switchLabel}</span>
        </label>
      </div>
    {/if}
    {#if travelActive}
      <div class="form-group">
        <div class="hint-row">
          <label class="form-label" for="f-travel-from">{TRAVEL_TEXTS.from}</label>
          <InfoHint
            testId="team-time-entry-modal-travel-hint"
            text={TRAVEL_TEXTS.hint}
            label={hintLabel(TRAVEL_TEXTS.from)}
          />
        </div>
        <select
          id="f-travel-from"
          class="form-input"
          required
          bind:value={formTravelFrom}
          data-testid="team-time-entry-modal-travel-from"
        >
          <option value="" disabled>{TRAVEL_TEXTS.placeholder}</option>
          {#each formSalonOptions as salon (salon.id)}
            <option value={salon.id}>{salon.name}</option>
          {/each}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="f-travel-to">{TRAVEL_TEXTS.to}</label>
        <select
          id="f-travel-to"
          class="form-input"
          required
          bind:value={formTravelTo}
          data-testid="team-time-entry-modal-travel-to"
        >
          <option value="" disabled>{TRAVEL_TEXTS.placeholder}</option>
          {#each travelToOptions as salon (salon.id)}
            <option value={salon.id}>{salon.name}</option>
          {/each}
        </select>
      </div>
    {:else}
      <div class="form-group">
        <label class="form-label" for="f-salon">Salon</label>
        <select
          id="f-salon"
          class="form-input"
          bind:value={formSalonId}
          data-testid="team-time-entry-modal-salon"
        >
          {#if !editEntry}<option value="">Automatisch (laut Plan)</option>{/if}
          {#each formSalonOptions as salon (salon.id)}
            <option value={salon.id}>{salon.name}</option>
          {/each}
        </select>
      </div>
    {/if}
  {/if}
  <div class="form-row-two">
    <div class="form-group">
      <label class="form-label" for="f-start">Arbeitsbeginn</label>
      <input id="f-start" type="time" bind:value={formStart} class="form-input" />
    </div>
    <div class="form-group">
      <div class="form-label-row">
        <label class="form-label" for="f-end">Arbeitsende</label>
        {#if !travelActive}
          <label class="end-toggle">
            <input type="checkbox" bind:checked={formHasEnd} aria-label="Arbeitsende erfasst" />
            <span class="text-muted end-toggle-hint">erfasst</span>
          </label>
        {/if}
      </div>
      <input
        id="f-end"
        type="time"
        bind:value={formEnd}
        class="form-input"
        disabled={!formHasEnd}
      />
    </div>
  </div>
  {#if !travelActive}
    <div class="breaks-section">
      <span class="form-label">Pausen</span>
      {#if editEntry && !editEntry.breaks?.length && (editEntry.breakMinutes ?? 0) > 0 && formBreaks.length === 0}
        <div class="break-legacy">
          <span class="text-muted">Pauschale: {editEntry.breakMinutes} Min.</span>
          <button
            class="btn btn-sm btn-ghost"
            type="button"
            onclick={() => {
              formBreaks = [
                proposeBreakSlot({
                  defaultBreakStart,
                  entryStart: formStart,
                  entryEnd: formHasEnd ? formEnd : null,
                  minutes: editEntry!.breakMinutes,
                }),
              ];
            }}>In Pausen umwandeln</button
          >
        </div>
      {/if}
      {#each formBreaks as brk, i (i)}
        <div class="break-row">
          <input
            type="time"
            bind:value={brk.start}
            class="form-input"
            aria-label={`Pause ${i + 1} Beginn`}
          />
          <span class="break-sep">&ndash;</span>
          <input
            type="time"
            bind:value={brk.end}
            class="form-input"
            aria-label={`Pause ${i + 1} Ende`}
          />
          <button
            class="btn-icon"
            type="button"
            onclick={() => (formBreaks = formBreaks.filter((_, j) => j !== i))}
            title="Pause entfernen">✕</button
          >
        </div>
      {/each}
      <button
        class="btn btn-sm btn-ghost"
        type="button"
        onclick={() =>
          (formBreaks = [
            ...formBreaks,
            proposeBreakSlot({
              defaultBreakStart,
              entryStart: formStart,
              entryEnd: formHasEnd ? formEnd : null,
              minutes: 30,
            }),
          ])}>+ Pause hinzufügen</button
      >
      {#if formBreakTotal > 0}
        <span class="text-muted break-total">Gesamt: {formBreakTotal} Min.</span>
      {/if}
    </div>
  {/if}
  <div class="form-group">
    <label class="form-label" for="f-note">Notiz <span class="text-muted">(optional)</span></label>
    <input
      id="f-note"
      type="text"
      bind:value={formNote}
      class="form-input"
      placeholder="z.B. Kundentermin…"
      maxlength="200"
    />
  </div>
  {#if isCorrectionEdit}
    <div class="form-group">
      <label class="form-label" for="f-reason">Begründung (Pflichtfeld) *</label>
      <textarea
        id="f-reason"
        class="form-input"
        rows="3"
        bind:value={formReason}
        placeholder="Bitte begründe die Korrektur."
      ></textarea>
    </div>
  {/if}
  {#if formNetMin !== null}
    <div class="net-display">
      <span class="net-label">Netto</span>
      <span
        class="net-value {modalWarnings.some((w) => w.code === 'MAX_DAILY_EXCEEDED')
          ? 'net-over'
          : ''}">{fmtMin(formNetMin)}<span class="net-unit">h</span></span
      >
    </div>
  {/if}
  {#if modalFindings.length > 0}
    <div class="modal-arbzg-warnings">
      {#each modalFindings as w, i (i)}
        <div class="arbzg-alert arbzg-{w.severity}" role="alert">
          <span class="arbzg-icon">{w.severity === "error" ? "⛔" : "⚠️"}</span>
          <span>{w.message}</span>
        </div>
      {/each}
    </div>
  {/if}
  {#if modalAutoBreak}
    <p class="text-muted">
      Mit automatischer Pause: beim Speichern wird eine Pause von {modalAutoBreak.minutes} Min. eingetragen.
    </p>
  {/if}
  {#each modalHints as h, i (i)}
    <p class="text-muted">{h.message}</p>
  {/each}
  {#if multiEntryUi}
    {#if editEntry}
      <div class="modal-additional">
        <button
          class="btn btn-outline btn-sm"
          type="button"
          onclick={() =>
            openAdditionalEntry((editEntry!.date ?? editEntry!.startTime).split("T")[0])}
          data-testid="team-time-entry-modal-add-additional">Weiteren Eintrag an diesem Tag</button
        >
      </div>
    {/if}
  {/if}
  {#snippet footer()}
    <button class="btn btn-ghost" onclick={closeModal} disabled={saving}>Abbrechen</button>
    <button class="btn btn-primary" onclick={saveEntry} disabled={saving}>
      {saving ? "Speichern…" : editEntry ? "Änderungen speichern" : "Zeit eintragen"}
    </button>
  {/snippet}
</Modal>

<!-- ── Quick 260824-cjd: Storno-Begründung (Zeiteintrag löschen) ────────────── -->
<ReasonDialog
  bind:open={deleteDialogOpen}
  title="Eintrag löschen?"
  confirmLabel="Löschen"
  danger
  onConfirm={confirmDeleteDialog}
  onCancel={() => (deleteConfirmId = "")}
/>

<style>
  /* ── Toolbar row (Issue #853, D-853-18; prototype .toolbar2) ─────────────────────
       Person picker, month and Kalender/Liste segment in one row under the tabs. The row lifts
       above the cards that follow so the month grid dropdown of the period control is not hidden
       by their backdrop-filter stacking contexts. */
  .te-controls-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2) var(--s-4);
    margin-bottom: var(--s-3);
    position: relative;
    z-index: 30;
  }

  /* The period keeps its label and arrows (block); only its page-sized padding goes, so the row
     starts at the page edge like the prototype's .period. */
  .te-controls-row :global(.month-bar) {
    padding: 0;
  }

  .te-view-segment {
    margin-left: auto;
  }

  /* MonthBar + mini-stats styles live in the MonthBar primitive. */

  /* ── Figures strip under the toolbar row (Issue #853) ─────────────────── */
  .te-figures {
    margin-bottom: 18px;
  }
  .te-denied-note {
    margin: calc(-1 * var(--s-2)) 0 18px;
    font-size: 0.875rem;
  }

  /* ── Day bar above the list (Issue #70): the focused day and its per-day add ─── */
  .list-day-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
  }
  .list-day-label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text);
  }
  /* Issue #92 - the trip switch, hint and route of the entry form and list. */
  .travel-switch {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.5rem;
    cursor: pointer;
  }
  .travel-route {
    display: inline-block;
    overflow-wrap: break-word;
  }
  .modal-additional {
    display: flex;
    margin-top: var(--s-3);
  }
  /* ── List view (Issue #853): the table is the DataTable block, its rows are tinted by the block's row tone. ── */
  .te-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .list-note {
    display: inline-block;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
  }

  /* ── List view actions always visible ────────────────── */
  .row-actions--visible {
    opacity: 1 !important;
  }

  /* .cal-grid + .cal-cell base recipe inherited from app.css (v1.5 canonical).
     Status modifiers (--ok, --partial, --missing), cell content typography
     (.day-worked, .day-bal) and the ArbZG mark recipe also live in app.css.
     See CLAUDE.md UI Consistency Rules: per-page overrides forbidden. */

  .day-before-hire {
    font-size: 0.75rem;
    color: var(--text-2);
    opacity: 0.5;
  }

  /* Status modifiers + cell-content typography → global app.css (v1.5 canonical). */

  /* Issue #992 (D-992-11): calendar hours never wrap inside their 52 px cell. */
  .day-worked {
    white-space: nowrap;
  }

  .cal-abs-type {
    display: block;
    font-size: 0.6rem;
    font-weight: 700;
    opacity: 0.65;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .day-missing {
    font-size: 0.7rem;
    font-family: var(--font-ui);
    color: var(--bad);
    opacity: 0.75;
  }

  /* Legende */
  .cal-legend {
    display: flex;
    gap: 0.75rem 1.75rem;
    padding: 0.875rem 1.25rem;
    flex-wrap: wrap;
  }
  .leg-group {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .leg-group-label {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--text-2);
    opacity: 0.7;
  }
  .leg {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-2);
  }
  .leg::before {
    content: "";
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 3px;
  }
  .leg-ok::before {
    background: var(--ok-soft);
    border: 1px solid color-mix(in srgb, var(--ok) 25%, transparent);
  }
  .leg-partial::before {
    background: var(--warn-soft);
    border: 1px solid color-mix(in srgb, var(--warn) 25%, transparent);
  }
  .leg-missing::before {
    background: var(--bad-soft);
    border: 1px solid color-mix(in srgb, var(--bad) 25%, transparent);
  }
  .leg-noexpect::before {
    background: var(--sunk);
    border: 1px solid var(--line);
  }
  /* Absence swatch: the colour is the custom property the template feeds from leave-colors.ts. */
  .leg-abs::before {
    background: var(--leg-fill);
    border: none;
  }
  /* bs-tage-in-calendar — Berufsschultag legend swatch. Mirrors the brand-tinted
     /shifts canonical BS treatment (sp-avail-badge--vocational-school). v1.5
     tokens only; no legacy color/gray namespaces. */
  .leg-abs-vocational_school::before {
    background: var(--brand);
    border: none;
  }
  /* The ArbZG entry shows the MARK itself, not a colour swatch — the legend must
     depict the thing it explains (quick task 260820-1i7). */
  .leg-arbzg::before {
    content: "⚠\FE0E";
    width: auto;
    height: auto;
    border: none;
    border-radius: 0;
    background: none;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    color: var(--text);
    opacity: 0.8;
  }

  /* bs-tage-in-calendar — Berufsschultag cell background. Uses --brand at the
     same 15% mix as the other .cal-abs-* recipes in app.css. Scoped to this
     page (the Berufsschule list rows use the block's `info` row tone); a token-level
     leave type for Berufsschule would be the long-term home if BS gets promoted
     to a first-class leave type. */
  :global(.cal-cell.cal-abs-vocational_school:not(.cal-selected)) {
    background: color-mix(in srgb, var(--brand) 15%, var(--card)) !important;
    opacity: 1;
  }

  /* ── Tagesdetail ──────────────────────────────────────────────────── */
  .day-detail {
    padding: 0;
    overflow: hidden;
  }

  .day-detail-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.875rem 1rem;
    gap: 1rem;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--sunk);
    background: var(--card);
  }

  .day-detail-title {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .day-detail-label {
    font-weight: 600;
    font-size: 0.9375rem;
  }

  .day-detail-stats {
    display: flex;
    gap: 0.875rem;
    flex-wrap: wrap;
    font-size: 0.8125rem;
  }

  .dstat {
    color: var(--text-2);
  }
  .dstat strong {
    color: var(--text);
    font-weight: 600;
  }
  .dstat.bal.pos strong {
    color: var(--ok);
  }
  .dstat.bal.neg strong {
    color: var(--bad);
  }

  .day-empty {
    padding: 1.5rem 1rem;
    display: flex;
    align-items: center;
    color: var(--text-2);
    font-size: 0.875rem;
  }

  /* ── Slots-Tabelle ────────────────────────────────────────────────── */
  .slots-wrap {
    overflow-x: auto;
  }
  .slots-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }
  .slots-table thead th {
    padding: 0.45rem 0.75rem;
    font-weight: 600;
    font-size: 0.7rem;
    color: var(--text-2);
    text-align: left;
    white-space: nowrap;
    background: var(--card);
    border-bottom: 1px solid var(--line);
  }
  .slots-table tbody td {
    padding: 0.5rem 0.75rem;
    border-top: 1px solid var(--sunk);
    vertical-align: middle;
  }
  .slots-table tbody tr:hover {
    background: var(--card);
  }
  .note-cell {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions-cell {
    width: 80px;
    text-align: right;
  }
  .mono {
    font-family: var(--font-ui);
  }
  .fw-med {
    font-weight: 500;
  }

  .row-actions {
    display: inline-flex;
    gap: 0.25rem;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .row-del td {
    background: var(--bad-soft);
  }

  .invalid-reason {
    color: var(--bad);
    font-size: 0.8rem;
    font-weight: 500;
  }

  .btn-xs {
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
  }
  .btn-icon {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 4px;
    font-size: 0.9375rem;
    line-height: 1;
    color: var(--text-2);
    transition: background 0.15s;
  }
  .btn-icon:hover {
    background: var(--sunk);
  }
  .btn-icon-danger {
    color: var(--text-2);
  }
  .btn-icon-danger:hover {
    background: var(--bad-soft);
    color: var(--bad);
  }

  .btn-danger-sm {
    color: var(--card);
    background: var(--bad);
    border-radius: 4px;
    font-size: 0.8125rem;
    padding: 0.125rem 0.375rem;
  }

  /* Modal styles live in the Modal primitive (.scrim/.modal/.modal-hd/.modal-foot). */

  /* ── Netto summary row ─────────────────────────────────────────── */
  .net-display {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: var(--sunk);
    border-radius: var(--r-control);
    margin-top: 4px;
  }
  .net-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
  }
  .net-value {
    font-family: var(--font-ui);
    font-variant-numeric: tabular-nums;
    font-size: 24px;
    font-weight: 400;
    color: var(--text);
    line-height: 1;
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
  }
  .net-value.net-over {
    color: var(--bad);
  }
  .net-unit {
    font-family: var(--font-ui);
    font-variant-numeric: normal;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-2);
  }

  .form-row-two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .form-label-row {
    display: flex;
    align-items: center;
    margin-bottom: 0.25rem;
  }
  .form-label-row .form-label {
    margin-bottom: 0;
  }
  .end-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    cursor: pointer;
    margin-left: 0.5rem;
  }
  .btn-sm {
    padding: 0.35rem 0.75rem;
    font-size: 0.875rem;
  }

  /* ── Pausen-Slots ──────────────────────────────────────────────── */
  .breaks-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .break-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .break-row .form-input {
    flex: 1;
    min-width: 0;
  }
  .break-sep {
    color: var(--text-2);
    font-weight: 600;
    flex-shrink: 0;
  }
  .break-total {
    font-size: 0.8125rem;
  }
  .break-legacy {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.625rem;
    background: var(--card);
    border-radius: 6px;
    font-size: 0.8125rem;
  }
  .break-cell {
    font-size: 0.8125rem;
    white-space: nowrap;
  }

  /* ── ArbZG-Warnungen ──────────────────────────────────────────────── */
  .modal-arbzg-warnings {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 0 26px 4px;
    margin-top: 4px;
  }
  .list-arbzg-hint {
    margin-left: 0.375rem;
    cursor: help;
    font-size: 0.8rem;
    position: relative;
  }
  .arbzg-tooltip {
    display: none;
    position: absolute;
    bottom: 100%;
    left: 0;
    background: var(--text);
    color: var(--card);
    font-size: 0.75rem;
    line-height: 1.4;
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    white-space: nowrap;
    z-index: 50;
    pointer-events: none;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    margin-bottom: 0.25rem;
  }
  .list-arbzg-hint:hover .arbzg-tooltip {
    display: block;
  }
  .day-warnings {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0.75rem 1rem 0;
  }

  .arbzg-alert {
    display: flex;
    align-items: flex-start;
    gap: 0.625rem;
    padding: 0.75rem 1rem;
    border-radius: 10px;
    font-size: 0.875rem;
    line-height: 1.5;
    animation: fadein 0.2s ease;
  }

  @keyframes fadein {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
    }
  }

  .arbzg-warning {
    background: var(--warn-soft);
    border: 1.5px solid var(--warn-soft);
    color: var(--warn);
  }
  .arbzg-error {
    background: var(--bad-soft);
    border: 1.5px solid var(--bad-soft);
    color: var(--bad);
  }

  .arbzg-icon {
    font-size: 1rem;
    line-height: 1.5;
    flex-shrink: 0;
  }

  .arbzg-alert span:nth-child(2) {
    flex: 1;
  }

  /* ── Mobile calendar improvements ──────────────────────────────── */
  @media (max-width: 640px) {
    /* Reduce cell height on mobile but keep them tappable */
    .cal-cell {
      min-height: 72px;
      padding: 0.375rem 0.375rem;
    }

    /* Hide balance detail on mobile — show only worked hours */
    .day-bal,
    .day-missing {
      display: none;
    }

    /* Compact worked-hours display: „8:00“ without the unit (the cell title keeps „8:00 h“) */
    .day-worked {
      font-size: 0.6875rem;
    }

    .day-unit {
      display: none;
    }

    /* Smaller day numbers on mobile */
    .cal-day-num {
      font-size: 0.75rem;
    }

    /* Holiday/absence labels smaller on mobile */
    .cal-holiday-label,
    .cal-abs-type {
      font-size: 0.5rem;
    }

    /* Larger touch target for "+ Slot" button */
    .day-detail-header .btn-sm {
      min-height: 44px;
      min-width: 44px;
      padding: 0.5rem 1rem;
      font-size: 0.9375rem;
    }

    /* Legend wraps tighter */
    .cal-legend {
      gap: 0.5rem 0.75rem;
    }
  }

  /* ── Person picker (Issue #853, D-853-10) ──────────────────────────── */
  /* In the toolbar row the flex basis decides; in the empty state (a shrink-wrapped column) the
     width does, so the placeholder is never cut. */
  .employee-selector {
    flex: 0 1 22rem;
    width: 22rem;
    min-width: 0;
    max-width: 100%;
    text-align: left;
  }
  /* Issue #853 (owner review): the Status cell of the figures strip, like Ich › Zeiten (#851). */
  .te-status {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .te-status-label {
    font-size: var(--fs-sm, 12.5px);
    color: var(--text-2);
  }
  .te-status-value {
    margin-top: var(--s-1);
  }
  .te-status-note {
    font-size: var(--fs-sm, 12.5px);
    color: var(--text-3);
  }
  /* The day cell: weekday and date, and a quiet „prüfen“ chip for a day with a finding. */
  .day-cell {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    white-space: nowrap;
  }
  /* A calendar day with a finding: a small warn dot instead of a symbol. */
  .cal-arbzg-mark {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--warn);
    opacity: 1;
  }
  .times-cell {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
  }
</style>
