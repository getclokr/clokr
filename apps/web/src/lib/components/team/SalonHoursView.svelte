<script lang="ts">
  // Issue #1030 - the Salonansicht of `/team/time-entries`: the hours raster of ONE salon, Person x
  // day, for a week or a calendar month. Presentation only: the server decides who is a row, which
  // hours the caller may see and every sum; this component adds nothing and never shows a Soll or a
  // saldo (those belong to the person - the info symbol beside the heading says so).
  // Mountable: no `$app` import, no request; the page loads the data and passes the status.
  import DataTable, { type DataTableColumn } from "$components/ui/DataTable.svelte";
  import ErrorState from "$components/ui/ErrorState.svelte";
  import InfoHint, { hintLabel } from "$components/ui/InfoHint.svelte";
  import KpiStrip, { type KpiItem } from "$components/ui/KpiStrip.svelte";
  import PeriodPicker from "$components/ui/PeriodPicker.svelte";
  import Skeleton from "$components/ui/Skeleton.svelte";
  import { fmtMin } from "$lib/utils/format-minutes";
  import {
    cellDisplay,
    countedThroughLabel,
    dayColumnLabel,
    dayFullLabel,
    defaultSalonPeriod,
    salonPeriodLabel,
    salonPeriodNextDisabled,
    salonPeriodWithZoom,
    shiftSalonPeriod,
    type SalonHoursBlock,
    type SalonHoursResponse,
    type SalonHoursRow,
    type SalonHoursStatus,
    type SalonPeriod,
  } from "$lib/team/salon-hours";

  interface Props {
    status: SalonHoursStatus;
    data: SalonHoursResponse | null;
    period: SalonPeriod;
    /** Tenant-local today (`YYYY-MM-DD`); the next arrow and „Heute“ read it. */
    todayStr: string;
    onPeriodChange: (next: SalonPeriod) => void;
    /** The chosen salon's name while the answer is still loading. */
    salonName?: string | null;
    errorMessage?: string;
    onRetry?: () => void;
  }

  let {
    status,
    data,
    period,
    todayStr,
    onPeriodChange,
    salonName = null,
    errorMessage = "Die Stunden konnten nicht geladen werden.",
    onRetry,
  }: Props = $props();

  // A type alias, because DataTable's row generic wants an object type.
  type RasterRow = { id: string; person: SalonHoursRow };

  const heading = $derived(data?.salonName ?? salonName ?? "Salon");
  const stichtag = $derived(countedThroughLabel(data?.countedThrough ?? null));

  const kpis = $derived<KpiItem[]>(
    data
      ? [
          {
            label: "Stunden im Salon",
            value: fmtMin(data.kpis.salonWorkedMinutes),
            explanation: stichtag,
            testId: "salon-hours-kpi-total",
          },
          {
            label: "Stammteam",
            value: fmtMin(data.kpis.stammteamMinutes),
            testId: "salon-hours-kpi-stammteam",
          },
        ]
      : [],
  );

  const columns = $derived<DataTableColumn[]>(
    data
      ? [
          { key: "person", label: "Person", primary: true },
          ...data.days.map((day): DataTableColumn => ({
            key: `d:${day}`,
            label: dayColumnLabel(day),
            title: dayFullLabel(day),
            align: "end",
          })),
          { key: "sum", label: `Summe ${stichtag}`, align: "end" },
        ]
      : [],
  );

  function tableRows(block: SalonHoursBlock): RasterRow[] {
    return block.rows.map((person) => ({ id: person.employeeId, person }));
  }

  /** A day is counted when it lies through the server's Stichtag. */
  function isCounted(day: string): boolean {
    return data?.countedThrough != null && day <= data.countedThrough;
  }

  /** A server total as H:MM; a counted day without hours reads „–“, a day not counted yet is empty. */
  function totalText(minutes: number, counted: boolean): string {
    return minutes > 0 ? fmtMin(minutes) : counted ? "–" : "";
  }

  function goToday() {
    onPeriodChange(defaultSalonPeriod(todayStr));
  }
</script>

{#snippet cell(row: RasterRow, column: DataTableColumn)}
  {#if column.key === "person"}
    <span class="salon-hours-person">
      {row.person.employeeName}
      {#if row.person.employeeNumber}
        <span class="salon-hours-number">{row.person.employeeNumber}</span>
      {/if}
    </span>
  {:else if column.key === "sum"}
    {fmtMin(row.person.totalMinutes)}
  {:else}
    {@const day = column.key.slice(2)}
    {@const found = row.person.cells.find((c) => c.date === day)}
    {#if found}
      <span class="salon-hours-cell" title={cellDisplay(found, row.person.employeeName).label}>
        {cellDisplay(found, row.person.employeeName).text}
      </span>
    {/if}
  {/if}
{/snippet}

{#snippet raster(block: SalonHoursBlock, caption: string, testId: string)}
  {#snippet totals(column: DataTableColumn)}
    {#if column.key === "person"}
      Summe je Tag
    {:else if column.key === "sum"}
      {fmtMin(block.totalMinutes)}
    {:else}
      {@const index = data?.days.indexOf(column.key.slice(2)) ?? -1}
      {#if index >= 0}
        {totalText(block.dayTotals[index] ?? 0, isCounted(column.key.slice(2)))}
      {/if}
    {/if}
  {/snippet}
  <div data-testid={testId}>
    <DataTable
      {columns}
      rows={tableRows(block)}
      rowKey={(row) => row.id}
      {cell}
      footer={totals}
      {caption}
    />
  </div>
{/snippet}

<div class="salon-hours" data-testid="salon-hours-view">
  {#if status === "prompt"}
    <div class="callout brand" role="status">
      <p>Wähl in der Kopfleiste einen Salon, um seine Stunden zu sehen.</p>
    </div>
  {:else if status === "rejected"}
    <div class="callout" role="status">
      <p>
        Für diesen Salon liegt keine Salonansicht vor. Wähl in der Kopfleiste einen anderen Salon.
      </p>
    </div>
  {:else}
    <div class="hint-row">
      <h2 class="salon-hours-title" data-testid="salon-hours-title">{heading}</h2>
      <InfoHint
        text="Soll, Saldo und Überstunden gehören zur Person, nicht zum Salon. Du findest sie in der Personenansicht."
        label={hintLabel("Stunden im Salon")}
        testId="salon-hours-person-figures-hint"
      />
    </div>
    <PeriodPicker
      label={salonPeriodLabel(period)}
      zooms={["woche", "monat"]}
      zoom={period.zoom}
      onZoom={(zoom) =>
        onPeriodChange(salonPeriodWithZoom(period, zoom === "monat" ? "monat" : "woche", todayStr))}
      onPrev={() => onPeriodChange(shiftSalonPeriod(period, -1))}
      onNext={() => onPeriodChange(shiftSalonPeriod(period, 1))}
      onToday={goToday}
      nextDisabled={salonPeriodNextDisabled(period, todayStr)}
      testIdPrefix="salon-hours-period"
    />
    {#if status === "loading"}
      <Skeleton shape="row" count={5} />
    {:else if status === "error" || data === null}
      <ErrorState message={errorMessage} hint="" onRetry={() => onRetry?.()} />
    {:else}
      <KpiStrip items={kpis} ariaLabel="Stunden im Salon" />
      <h2 class="salon-hours-sub">Stammteam</h2>
      {@render raster(
        data.stammteam,
        `Stammteam in ${data.salonName}, ${salonPeriodLabel(period)}`,
        "salon-hours-stammteam",
      )}
    {/if}
  {/if}
</div>

<style>
  .salon-hours {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    min-width: 0;
  }

  .salon-hours-title {
    margin: 0;
    font-size: var(--fs-h2);
    font-weight: 600;
    color: var(--text);
  }

  .salon-hours-sub {
    margin: var(--s-2) 0 0;
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text);
  }

  .salon-hours-person {
    display: flex;
    flex-direction: column;
    padding-block: var(--s-1);
  }

  .salon-hours-number {
    font-size: var(--fs-sm);
    font-weight: 400;
    color: var(--text-2);
  }

  .salon-hours-cell {
    font-variant-numeric: tabular-nums;
  }
</style>
