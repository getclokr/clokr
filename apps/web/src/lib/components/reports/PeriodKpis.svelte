<script lang="ts">
  import { personsLabel } from "$lib/utils/count-word";
  // Issue #612 (D-612-3) rebuilt on the blocks for Issue #854 (D-854-22): the figures of the period
  // as KpiStrips - the time figures, the vacation figures and, under a salon filter, the hours
  // worked in the salon in a strip of their own. Pattern 3: every value is the server's own figure
  // (minutes, days) formatted here; nothing is added, derived or recomputed. A figure the caller
  // may not see arrives as `null` and renders as a dash with the reason as its delta line, so the
  // strip never jumps.
  // Issue #714: under a salon filter the strips show the whole sums of the persons by Stammsalon at
  // the period end, with the owner's hint; the hours worked in the salon are a separate strip with
  // no saldo beside it, so they never meet Soll.
  // Issue #985 (D-01): a running-month answer names its Stichtag (Soll, Ist and saldo through yesterday).
  import KpiStrip, { type KpiItem } from "$components/ui/KpiStrip.svelte";
  import InfoHint, { hintLabel } from "$components/ui/InfoHint.svelte"; // Issue #1058
  import Skeleton from "$components/ui/Skeleton.svelte";
  import type { PeriodKpis } from "$lib/reports/period-report";
  import { dayUnit } from "$lib/leave/leave-days-label"; // Issue #993 N-05
  import { fmtDateDe, fmtDaysDe, fmtHoursDe, runningMonthNote } from "$lib/reports/period-format";
  import {
    HOME_SALON_CHANGE_NOTE,
    PERSON_SALDO_BY_HOME_SALON_LABEL,
    SALON_WORKED_DELTA_NOTE,
    SALON_WORKED_LABEL,
    withoutHomeSalonNote,
  } from "$lib/salons/page-scope";

  interface Props {
    /** The `kpis` object of the period answer; null until the first answer. */
    kpis: PeriodKpis | null;
    /** A salon filter applies (persons by Stammsalon, whole values, #714). */
    filterActive: boolean;
    /** Persons of the reach without a Stammsalon in an active salon; null without a filter. */
    withoutHomeSalonCount?: number | null;
    /** A request is in flight; without `kpis` this renders the skeleton. */
    loading: boolean;
    /** The answer's `to` (`YYYY-MM`); names the running month's Stichtag (#985). Null: no note. */
    periodTo?: string | null;
    /**
     * Issue #993 N-10 (D-993-03): each period tab shows its own figures - the time strip on
     * "zeiten", the vacation strip on "urlaub". A caller that passes nothing gets the time figures.
     */
    tab?: "zeiten" | "urlaub";
  }

  let {
    kpis,
    filterActive,
    withoutHomeSalonCount = null,
    loading,
    periodTo = null,
    tab = "zeiten",
  }: Props = $props();

  const DASH = "—";
  // A salon filter withholds nothing (#714): the only reason a figure is missing is the permission.
  const WITHHELD_REASON = "Keine Berechtigung";

  const showSkeleton = $derived(kpis === null && loading);
  const runningNote = $derived(
    kpis !== null && periodTo !== null ? runningMonthNote(periodTo, kpis.closingAsOf) : null,
  );

  function hours(min: number | null, signed: boolean): string {
    return min === null ? DASH : fmtHoursDe(min, { signed });
  }

  const timeItems = $derived.by((): KpiItem[] => {
    if (kpis === null) return [];
    const balanceDelta =
      kpis.balanceMinutes === null
        ? WITHHELD_REASON
        : kpis.allMonthsConfirmed
          ? "bestätigt"
          : "enthält Prognose";
    const closingDelta =
      kpis.closingBalanceMinutes === null
        ? WITHHELD_REASON
        : `Stand ${fmtDateDe(kpis.closingAsOf)} · ${kpis.closingConfirmed ? "bestätigt" : "Prognose"}`;
    return [
      {
        label: "Saldo im Zeitraum",
        value: hours(kpis.balanceMinutes, true),
        unit: kpis.balanceMinutes === null ? undefined : "h",
        delta: balanceDelta,
      },
      {
        label: "Gesamtsaldo am Ende",
        value: hours(kpis.closingBalanceMinutes, true),
        unit: kpis.closingBalanceMinutes === null ? undefined : "h",
        delta: closingDelta,
      },
      { label: "Ist", value: fmtHoursDe(kpis.workedMinutes), unit: "h" },
      {
        label: "Soll",
        value: hours(kpis.expectedMinutes, false),
        unit: kpis.expectedMinutes === null ? undefined : "h",
        delta: kpis.expectedMinutes === null ? WITHHELD_REASON : undefined,
      },
    ];
  });

  const vacationItems = $derived.by((): KpiItem[] => {
    if (kpis === null) return [];
    return [
      {
        label: "Urlaub genommen",
        value: kpis.vacationTakenDays,
        format: fmtDaysDe,
        unit: dayUnit(kpis.vacationTakenDays),
        delta: `bis ${fmtDateDe(kpis.vacationAsOf)}, Urlaubsjahr ${kpis.vacationYear}`,
      },
      {
        label: "Urlaub genehmigt",
        value: kpis.vacationApprovedDays,
        format: fmtDaysDe,
        unit: dayUnit(kpis.vacationApprovedDays),
        delta: `nach ${fmtDateDe(kpis.vacationAsOf)}, Urlaubsjahr ${kpis.vacationYear}`,
      },
      {
        label: "Urlaubsanspruch",
        value: kpis.vacationEntitlementDays,
        format: fmtDaysDe,
        unit: dayUnit(kpis.vacationEntitlementDays),
        delta: `Urlaubsjahr ${kpis.vacationYear}`,
      },
      {
        label: "Krankheitstage",
        value: kpis.sickDays,
        format: fmtDaysDe,
        unit: dayUnit(kpis.sickDays),
        delta: "Kalendertage",
      },
    ];
  });

  const personsNote = $derived(
    kpis === null ? null : `Summe über ${personsLabel(kpis.personCount)}`,
  );
  // Saldo is covered for fewer persons than listed: say so (and only then).
  const saldoNote = $derived(
    kpis !== null && kpis.saldoPersonCount > 0 && kpis.saldoPersonCount < kpis.personCount
      ? `Saldo: Summe über ${kpis.saldoPersonCount} von ${kpis.personCount} Personen`
      : null,
  );
  const forecastNote = $derived(kpis !== null && !kpis.allMonthsConfirmed);
  const salonItems = $derived.by((): KpiItem[] => {
    if (!filterActive || kpis === null || typeof kpis.salonWorkedMinutes !== "number") return [];
    return [
      {
        label: SALON_WORKED_LABEL,
        value: fmtHoursDe(kpis.salonWorkedMinutes),
        unit: "h",
        delta: SALON_WORKED_DELTA_NOTE,
      },
    ];
  });
</script>

<div class="period-figures" data-testid="period-kpis" aria-busy={loading}>
  {#if showSkeleton}
    <div class="figures-skeleton" data-testid="period-kpis-skeleton">
      <Skeleton shape="block" count={4} height="3rem" />
    </div>
  {:else if kpis}
    {#if tab === "zeiten"}
      <KpiStrip items={timeItems} ariaLabel="Zeiten und Konten im Zeitraum" />
    {/if}

    {#if runningNote}
      <p class="period-figure-note" data-testid="period-kpis-running-month">{runningNote}</p>
    {/if}

    <!-- Issue #1058: what the figures sum over, and under a salon filter how persons are assigned,
         are explanations: info symbols under the strip they belong to. -->
    <div class="hint-row period-figure-hints">
      <InfoHint
        testId="period-kpis-persons"
        text={tab === "zeiten" && saldoNote ? [personsNote ?? "", saldoNote] : (personsNote ?? "")}
        label={hintLabel(tab === "zeiten" ? "Zeiten und Konten" : "Urlaub und Krankheit")}
      />
      {#if filterActive}
        <InfoHint
          testId="period-kpis-salon-note"
          text={[
            `${PERSON_SALDO_BY_HOME_SALON_LABEL}. ${HOME_SALON_CHANGE_NOTE}`,
            ...(withoutHomeSalonCount !== null && withoutHomeSalonCount > 0
              ? [withoutHomeSalonNote(withoutHomeSalonCount)]
              : []),
          ]}
          label={hintLabel("Personen nach Stammsalon")}
        />
      {/if}
    </div>

    {#if tab === "urlaub"}
      <KpiStrip items={vacationItems} ariaLabel="Urlaub und Krankheit im Zeitraum" />
    {:else}
      {#if salonItems.length > 0}
        <div data-testid="period-kpis-salon-hours">
          <KpiStrip items={salonItems} ariaLabel="Im Salon gearbeitet" />
        </div>
      {/if}

      {#if forecastNote}
        <p class="period-figure-note" data-testid="period-kpis-forecast-note">
          Offene Monate sind eine Prognose und ändern sich bis zum Monatsabschluss.
        </p>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .period-figures {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    min-width: 0;
  }

  /* The Skeleton region lays its four lines (one strip) out in the columns of the real strip. */
  .figures-skeleton :global(.skeleton-region) {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    column-gap: var(--s-6);
    row-gap: var(--s-4);
  }

  @media (max-width: 960px) {
    .figures-skeleton :global(.skeleton-region) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .period-figure-hints {
    gap: var(--s-2);
  }

  .period-figure-note {
    margin: 0;
    font-size: var(--fs-xs);
    line-height: 1.4;
    color: var(--text-2);
  }
</style>
