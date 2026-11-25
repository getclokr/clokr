<script lang="ts">
  // Issue #597 (Phase 851, prototype „Nächste Wochen“): the own shifts from today to the end of the week
  // after next (the rest of this week plus two full weeks, Issue #991 N-22) with their salon, effective
  // leave and the holidays of the Stammsalon in one stream. Reads GET /shifts/range
  // (own shifts, shift:read:EIGENE), GET /leave/requests (own) and GET /holidays (Stammsalon); the
  // grouping is lib/me/agenda.ts. The salon name comes from the own salon context; a salon outside it
  // is named „anderer Salon“.
  //
  // Issue #589 (D-589-09, D-589-10, D-589-11): the component WAITS for `$salonContext.loaded`. Before the
  // store has loaded, `homeSalonId` is null and the names map is empty, so every shift was named „anderer
  // Salon“ and the holidays of the Stammsalon were never requested - the root cause of both symptoms the
  // owner saw on 15.11.2026. It also fetches the own contract (GET /employees/:id, `workSchedule`) and
  // full ISO weeks of shifts (Monday of the first week to Sunday of the last), so „Frei“ (no contract
  // work) can be told from „Noch nicht geplant“ and the week rule sees earlier days of the current week.
  //
  // Issue #1011: the shift read names the own employeeId (a caller with shift:read:ZUGEWIESEN gets the own
  // shifts, not 400 „employeeId erforderlich“), and a failed shift read shows the error state instead of
  // an empty plan.
  import { api } from "$api/client";
  import { authStore } from "$stores/auth";
  import { salonContext } from "$stores/salon-context";
  import { tenantFeatures } from "$stores/tenant-features";
  import { tenantDayAnchor } from "$lib/utils/tenant-day";
  import Chip from "$components/ui/Chip.svelte";
  import Skeleton from "$components/ui/Skeleton.svelte";
  import ErrorState from "$components/ui/ErrorState.svelte";
  import EmptyState from "$components/ui/EmptyState.svelte";
  import { fmtMin } from "$lib/utils/format-minutes";
  import {
    agendaWindow,
    buildAgenda,
    type AgendaContract,
    type AgendaShift,
    type AgendaWeek,
  } from "$lib/me/agenda";

  interface OwnRequest {
    typeCode: string | null;
    startDate: string;
    endDate: string;
    status: string;
    halfDay: boolean;
  }

  const LEAVE_LABEL: Record<string, string> = {
    VACATION: "Urlaub",
    OVERTIME_COMP: "Überstundenausgleich",
    SICK: "Krank",
    SICK_CHILD: "Kind krank",
  };

  let loading = $state(true);
  let failed = $state(false);
  let weeks = $state<AgendaWeek[]>([]);

  function iso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /** Monday of the local ISO week of a date. */
  function mondayOf(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  }

  async function load() {
    loading = true;
    failed = false;
    // "Today" is the tenant's day (Issue #1072): a calendar anchor whose local fields are that day.
    const start = tenantDayAnchor(new Date(), await tenantFeatures.loadTimezone());
    const { days } = agendaWindow(start);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days - 1);
    // Whole ISO weeks: the week rule of the agenda needs the shifts of the days before today as well.
    const fetchFrom = mondayOf(start);
    const lastMonday = mondayOf(end);
    const fetchTo = new Date(
      lastMonday.getFullYear(),
      lastMonday.getMonth(),
      lastMonday.getDate() + 6,
    );
    const homeSalonId = $salonContext.homeSalonId;
    const employeeId = $authStore.user?.employeeId ?? "";
    const years = [...new Set([start.getFullYear(), end.getFullYear()])];
    try {
      const [shifts, requests, holidays, own] = await Promise.all([
        // Issue #1011: the own employeeId is sent so a caller with shift:read:ZUGEWIESEN (Salonleitung,
        // Inhaberin) reads the own shifts instead of 400 „employeeId erforderlich“. A failed read rejects
        // the outer Promise.all and shows the error state - never an empty plan.
        api.get<AgendaShift[]>(
          `/shifts/range?from=${iso(fetchFrom)}&to=${iso(fetchTo)}${
            employeeId ? `&employeeId=${employeeId}` : ""
          }`,
        ),
        Promise.all(
          years.map((y) =>
            api.get<OwnRequest[]>(`/leave/requests?year=${y}&employeeId=${employeeId}`),
          ),
        ).then((r) => r.flat()),
        homeSalonId
          ? Promise.all(
              years.map((y) =>
                api.get<{ date: string; name: string }[]>(
                  `/holidays?year=${y}&salonId=${homeSalonId}`,
                ),
              ),
            ).then((r) => r.flat())
          : Promise.resolve([] as { date: string; name: string }[]),
        // The own contract (newest row); a failed read means "unknown" and falls back to the week rule.
        employeeId
          ? api
              .get<{ workSchedule?: AgendaContract | null }>(`/employees/${employeeId}`)
              .catch(() => null)
          : Promise.resolve(null),
      ]);
      const names = new Map($salonContext.salons.map((s) => [s.id, s.name]));
      weeks = buildAgenda(start, days, {
        shifts,
        leave: requests.map((r) => ({
          startDate: r.startDate,
          endDate: r.endDate,
          status: r.status,
          halfDay: r.halfDay,
          label: (r.typeCode && LEAVE_LABEL[r.typeCode]) ?? "Abwesend",
        })),
        holidays,
        salonNames: names,
        contract: own?.workSchedule ?? null,
      });
    } catch {
      failed = true;
    } finally {
      loading = false;
    }
  }

  // Nothing planned at all: no day of kind shift, leave or holiday (a „Noch nicht geplant“ day is no plan).
  const empty = $derived(
    weeks.every((w) =>
      w.days.every((d) => d.kind !== "shift" && d.kind !== "leave" && d.kind !== "holiday"),
    ),
  );

  // Load once, as soon as the salon context is there (D-589-11). The retry button calls `load()` itself.
  let started = false;
  $effect(() => {
    if ($salonContext.loaded && !started) {
      started = true;
      void load();
    }
  });
</script>

{#if loading}
  <Skeleton shape="row" count={6} />
{:else if failed}
  <ErrorState message="Dein Dienstplan ist gerade nicht erreichbar." onRetry={load} />
{:else}
  {#if empty}
    <EmptyState
      icon="calendar"
      title="Noch keine Schichten geplant"
      description="Sobald deine Salonleitung dich einplant, siehst du hier, wann und wo du arbeitest."
    />
  {/if}
  <div class="agenda" data-testid="my-shift-agenda">
    {#each weeks as week (week.label)}
      <h2 class="agenda-week">{week.label}</h2>
      <ul class="agenda-list">
        {#each week.days as day (day.date)}
          <li
            class="agenda-day"
            class:agenda-day--today={day.isToday}
            data-testid="agenda-{day.date}"
          >
            <div class="agenda-date">
              <span>{day.weekday}</span>
              <b>{day.dayLabel}</b>
            </div>
            <div class="agenda-text">
              <div class="agenda-title">{day.title}</div>
              {#if day.subtitle}<div class="agenda-sub">{day.subtitle}</div>{/if}
            </div>
            <div class="agenda-end">
              {#if day.otherSalon}
                <Chip tone="warn">anderer Salon</Chip>
              {:else if day.kind === "shift" && day.netMinutes > 0}
                <Chip tone="neutral">{fmtMin(day.netMinutes)} h</Chip>
              {:else if day.kind === "holiday"}
                <Chip tone="info">Feiertag</Chip>
              {:else if day.kind === "leave"}
                <Chip tone="brand">Abwesend</Chip>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/each}
  </div>
{/if}

<style>
  .agenda {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .agenda-week {
    margin: var(--s-4) 0 var(--s-1);
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-2);
  }
  .agenda-week:first-child {
    margin-top: 0;
  }
  .agenda-list {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--r-card);
  }
  .agenda-day {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s-3);
    min-height: var(--h-row);
    padding: var(--s-2) var(--s-4);
    border-bottom: 1px solid var(--line);
  }
  .agenda-day:last-child {
    border-bottom: 0;
  }
  .agenda-day--today {
    background: var(--brand-tint);
  }
  .agenda-date {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .agenda-date b {
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .agenda-title {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .agenda-sub {
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
</style>
