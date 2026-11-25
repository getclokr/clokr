<script lang="ts">
  // Issue #1030 - the Salonansicht of `/team/time-entries`: the hours raster of ONE salon, Person x
  // day, for a week or a calendar month. Presentation only: the server decides who is a row, which
  // hours the caller may see and every sum; this component adds nothing and never shows a Soll or a
  // saldo (those belong to the person - the info symbol beside the heading says so).
  // Mountable: no `$app` import, no request; the page loads the data and passes the status.
  import DataTable, { type DataTableColumn } from "$components/ui/DataTable.svelte";
  import Chip from "$components/ui/Chip.svelte";
  import ErrorState from "$components/ui/ErrorState.svelte";
  import InfoHint, { hintLabel } from "$components/ui/InfoHint.svelte";
  import KpiStrip, { type KpiItem } from "$components/ui/KpiStrip.svelte";
  import PeriodPicker from "$components/ui/PeriodPicker.svelte";
  import Skeleton from "$components/ui/Skeleton.svelte";
  import { fmtMin } from "$lib/utils/format-minutes";
  import { SALON_HELPERS_HEADING } from "$lib/salons/page-scope";
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
    type SalonHoursHelperBlock,
    type SalonHoursHelperRow,
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
    /** Persons whose day the caller can open (master-data reach); only their cells are buttons. */
    clickableIds?: ReadonlySet<string>;
    /** A click on the cell of a clickable person: opens that person's day. */
    onCellOpen?: (employeeId: string, day: string) => void;
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
    clickableIds = new Set<string>(),
    onCellOpen,
  }: Props = $props();

  // A type alias, because DataTable's row generic wants an object type.
  type RasterRow = {
    id: string;
    person: SalonHoursRow;
    /** The Stammsalon column of an Aushilfen row; undefined in the Stammteam block. */
    home?: string;
  };

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
          {
            label: "Aushilfen",
            value: fmtMin(data.kpis.aushilfenMinutes),
            testId: "salon-hours-kpi-aushilfen",
          },
        ]
      : [],
  );

  /** The columns of a block: Person, the Stammsalon of an Aushilfe, one per day, the sum. */
  function columnsFor(helpers: boolean): DataTableColumn[] {
    if (!data) return [];
    return [
      { key: "person", label: "Person", primary: true },
      ...(helpers ? [{ key: "home", label: "Stammsalon" } satisfies DataTableColumn] : []),
      ...data.days.map((day): DataTableColumn => ({
        key: `d:${day}`,
        label: dayColumnLabel(day),
        title: dayFullLabel(day),
        align: "end",
      })),
      { key: "sum", label: `Summe ${stichtag}`, align: "end" },
    ];
  }

  function tableRows(block: SalonHoursBlock): RasterRow[] {
    return block.rows.map((person) => ({ id: person.employeeId, person }));
  }

  function helperRows(block: SalonHoursHelperBlock): RasterRow[] {
    return block.rows.map((person: SalonHoursHelperRow) => ({
      id: person.employeeId,
      person,
      home: person.homeSalonName ?? "ohne Stammsalon",
    }));
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
  {:else if column.key === "home"}
    {row.home}
  {:else if column.key === "sum"}
    {fmtMin(row.person.totalMinutes)}
  {:else}
    {@const day = column.key.slice(2)}
    {@const found = row.person.cells.find((c) => c.date === day)}
    {#if found}
      {@const display = cellDisplay(found, row.person.employeeName)}
      {#snippet content()}
        <span class="salon-hours-cell-text">{display.text}</span>
        {#each display.chips as chip (chip.text)}
          <Chip tone={chip.tone}>{chip.text}</Chip>
        {/each}
      {/snippet}
      {#if clickableIds.has(row.person.employeeId)}
        <button
          type="button"
          class="salon-hours-cell-button"
          aria-label={display.label}
          onclick={() => onCellOpen?.(row.person.employeeId, day)}
        >
          {@render content()}
        </button>
      {:else}
        <span class="salon-hours-cell" title={display.label}>{@render content()}</span>
      {/if}
    {/if}
  {/if}
{/snippet}

{#snippet raster(
  block: SalonHoursBlock | SalonHoursHelperBlock,
  rows: RasterRow[],
  columns: DataTableColumn[],
  caption: string,
  testId: string,
)}
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
    <DataTable {columns} {rows} rowKey={(row) => row.id} {cell} footer={totals} {caption} />
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
        tableRows(data.stammteam),
        columnsFor(false),
        `Stammteam in ${data.salonName}, ${salonPeriodLabel(period)}`,
        "salon-hours-stammteam",
      )}
      <h2 class="salon-hours-sub">{SALON_HELPERS_HEADING}</h2>
      {#if data.aushilfen.rows.length === 0}
        <p class="salon-hours-calm" data-testid="salon-hours-no-helpers">
          Keine Aushilfen aus anderen Salons in diesem Zeitraum.
        </p>
      {:else}
        {@render raster(
          data.aushilfen,
          helperRows(data.aushilfen),
          columnsFor(true),
          `${SALON_HELPERS_HEADING} in ${data.salonName}, ${salonPeriodLabel(period)}`,
          "salon-hours-aushilfen",
        )}
      {/if}
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

  .salon-hours-cell,
  .salon-hours-cell-button {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--s-1);
    font-variant-numeric: tabular-nums;
  }

  /* A clickable cell is a real button: no frame at rest, the person's day opens on activation. */
  .salon-hours-cell-button {
    min-height: var(--h-control);
    padding: 0 var(--s-1);
    border: 0;
    border-radius: var(--r-control);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .salon-hours-cell-button:hover {
    background: var(--hover);
  }

  .salon-hours-cell-button:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  .salon-hours-calm {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
</style>
