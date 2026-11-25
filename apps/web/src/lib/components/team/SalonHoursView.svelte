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
  import List from "$components/ui/List.svelte";
  import ListRow from "$components/ui/ListRow.svelte";
  import PeriodPicker from "$components/ui/PeriodPicker.svelte";
  import Skeleton from "$components/ui/Skeleton.svelte";
  import { fmtMin } from "$lib/utils/format-minutes";
  import { SALON_HELPERS_HEADING } from "$lib/salons/page-scope";
  import {
    cellDisplay,
    combinedDayTotals,
    countedThroughLabel,
    dayColumnLabel,
    dayFullLabel,
    openItemSubtitle,
    rowHasContent,
    defaultSalonPeriod,
    salonPeriodLabel,
    salonPeriodNextDisabled,
    salonPeriodWithZoom,
    shiftSalonPeriod,
    type SalonHoursExchangeGroup,
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
    /** The Aufgaben „Ausstempeln fehlt“ for callers who may open that page, else null (no link). */
    aufgabenHref?: string | null;
    /** The caller holds the export right: the exchange card offers the CSV download. */
    canExport?: boolean;
    onExport?: () => void;
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
    aufgabenHref = null,
    canExport = false,
    onExport,
  }: Props = $props();

  // A type alias, because DataTable's row generic wants an object type. One row of the ONE raster:
  // the Stammteam and the Aushilfen are groups of the same table, so the day columns line up.
  type RasterRow = {
    id: string;
    group: "stammteam" | "aushilfen";
    person: SalonHoursRow;
    /** The Stammsalon line under the name of an Aushilfe; undefined for the Stammteam. */
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
          {
            label: "Offen",
            value: data.kpis.openCount,
            explanation: "fehlende Ausstempelungen",
            testId: "salon-hours-kpi-open",
          },
        ]
      : [],
  );

  // Widths of the raster: the person column and the sum are fixed, the day columns share the rest
  // equally; the table never gets narrower than its columns (a month scrolls inside its card).
  const PERSON_WIDTH_REM = 13;
  const SUM_WIDTH_REM = 5;
  const DAY_MIN_REM = 4.5;

  /** The columns of the raster: Person, one equal column per day, the sum. */
  const columns = $derived<DataTableColumn[]>(
    data
      ? [
          { key: "person", label: "Person", primary: true, width: `${PERSON_WIDTH_REM}rem` },
          // A no-break space keeps „Mo 23.“ on one line in the head (and in the card label).
          ...data.days.map((day): DataTableColumn => ({
            key: `d:${day}`,
            label: dayColumnLabel(day).replace(" ", "\u00a0"),
            title: dayFullLabel(day),
            align: "end",
          })),
          {
            key: "sum",
            label: "Summe",
            title: `Summe ${stichtag}`,
            align: "end",
            width: `${SUM_WIDTH_REM}rem`,
          },
        ]
      : [],
  );
  const minWidth = $derived(
    `${PERSON_WIDTH_REM + SUM_WIDTH_REM + DAY_MIN_REM * (data?.days.length ?? 0)}rem`,
  );

  const rasterRows = $derived<RasterRow[]>(
    data
      ? [
          ...data.stammteam.rows.map((person): RasterRow => ({
            id: person.employeeId,
            group: "stammteam",
            person,
          })),
          ...data.aushilfen.rows.map((person: SalonHoursHelperRow): RasterRow => ({
            id: person.employeeId,
            group: "aushilfen",
            person,
            home: person.homeSalonName ? `Stammsalon ${person.homeSalonName}` : "ohne Stammsalon",
          })),
        ]
      : [],
  );

  const dayTotals = $derived(data ? combinedDayTotals(data) : []);

  function groupTitle(group: string): string {
    if (!data) return group;
    return group === "aushilfen"
      ? `${SALON_HELPERS_HEADING} (${data.aushilfen.rows.length})`
      : `Stammteam (${data.stammteam.rows.length})`;
  }

  // The exchange card: one row per counterpart salon, the server's persons and minutes.
  function personsText(count: number): string {
    return count === 1 ? "1 Person" : `${count} Personen`;
  }

  function goToday() {
    onPeriodChange(defaultSalonPeriod(todayStr));
  }
</script>

{#snippet cell(row: RasterRow, column: DataTableColumn)}
  {#if column.key === "person"}
    <span class="salon-hours-person">
      {row.person.employeeName}
      {#if row.home}
        <span class="salon-hours-sub-line">{row.home}</span>
      {/if}
      {#if !rowHasContent(row.person.cells)}
        <span class="salon-hours-none-note">keine Stunden in diesem Zeitraum</span>
      {/if}
    </span>
  {:else if column.key === "sum"}
    {#if row.person.totalMinutes > 0}
      {fmtMin(row.person.totalMinutes)}
    {:else}
      <span class="salon-hours-nil">–</span>
    {/if}
  {:else}
    {@const day = column.key.slice(2)}
    {@const found = row.person.cells.find((c) => c.date === day)}
    {#if found}
      {@const display = cellDisplay(found, row.person.employeeName)}
      {#snippet content()}
        {#if display.nil}
          <span class="salon-hours-nil">–</span>
        {:else}
          {#if display.text}<span class="salon-hours-hours">{display.text}</span>{/if}
          {#each display.chips as chip (chip.text)}
            <Chip tone={chip.tone}>{chip.text}</Chip>
          {/each}
        {/if}
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

{#snippet totals(column: DataTableColumn)}
  {#if column.key === "person"}
    Summe im Salon
  {:else if column.key === "sum"}
    {#if data && data.kpis.salonWorkedMinutes > 0}
      {fmtMin(data.kpis.salonWorkedMinutes)}
    {:else}
      <span class="salon-hours-nil">–</span>
    {/if}
  {:else}
    {@const index = data?.days.indexOf(column.key.slice(2)) ?? -1}
    {#if index >= 0 && (dayTotals[index] ?? 0) > 0}
      {fmtMin(dayTotals[index])}
    {:else}
      <span class="salon-hours-nil">–</span>
    {/if}
  {/if}
{/snippet}

{#snippet groupHeader(name: string)}
  {groupTitle(name)}
{/snippet}

{#snippet exchange(title: string, groups: SalonHoursExchangeGroup[], testId: string)}
  <div class="salon-hours-exchange-part">
    <h3 class="salon-hours-exchange-title">{title}</h3>
    {#if groups.length === 0}
      <p class="salon-hours-calm">Keine Stunden in diesem Zeitraum.</p>
    {:else}
      <div data-testid={testId}>
        <List ariaLabel={title}>
          {#each groups as group (group.salonId ?? "none")}
            <ListRow
              avatar={false}
              title={group.salonName ?? "ohne Stammsalon"}
              subtitle={personsText(group.persons)}
            >
              {#snippet trailing()}<strong class="salon-hours-exchange-hours"
                  >{fmtMin(group.minutes)}</strong
                >{/snippet}
            </ListRow>
          {/each}
        </List>
      </div>
    {/if}
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
      <div class="salon-hours-layout">
        <section class="salon-hours-main" aria-labelledby="salon-hours-raster-heading">
          <div class="salon-hours-main-head">
            <h2 class="salon-hours-sub" id="salon-hours-raster-heading">
              Stunden in {data.salonName}, pro Person und Tag
            </h2>
            {#if clickableIds.size > 0}
              <span class="salon-hours-calm">Klick auf eine Zelle öffnet den Tag der Person</span>
            {/if}
          </div>
          <div data-testid="salon-hours-raster">
            <DataTable
              listId="team.zeiten.salon-stunden"
              {columns}
              rows={rasterRows}
              rowKey={(row) => row.id}
              rowGroup={(row) => row.group}
              {groupHeader}
              rowAttrs={(row) => ({ "data-group": row.group })}
              {cell}
              footer={totals}
              fixedMinWidth={minWidth}
              stickyFirst
              caption={`Stunden in ${data.salonName}, ${salonPeriodLabel(period)}, ${stichtag}`}
            />
          </div>
          {#if data.aushilfen.rows.length === 0}
            <p class="salon-hours-calm" data-testid="salon-hours-no-helpers">
              Keine Aushilfen aus anderen Salons in diesem Zeitraum.
            </p>
          {/if}
        </section>

        <aside class="salon-hours-aside">
          <section class="card" aria-labelledby="salon-hours-open-heading">
            <h2 class="salon-hours-sub" id="salon-hours-open-heading">Offen in diesem Salon</h2>
            {#if data.open.length === 0}
              <p class="salon-hours-calm" data-testid="salon-hours-no-open">
                Nichts offen in diesem Zeitraum.
              </p>
            {:else}
              <List ariaLabel="Offen in diesem Salon" testId="salon-hours-open-list">
                {#each data.open as item (`${item.employeeId}:${item.date}:${item.startTime}`)}
                  <ListRow
                    title={item.employeeName}
                    subtitle={openItemSubtitle(item)}
                    onPrimary={clickableIds.has(item.employeeId) && onCellOpen
                      ? () => onCellOpen(item.employeeId, item.date)
                      : undefined}
                  />
                {/each}
              </List>
            {/if}
            {#if aufgabenHref}
              <a class="salon-hours-link" href={aufgabenHref}>Zu den Aufgaben</a>
            {/if}
          </section>

          <section class="card" aria-labelledby="salon-hours-exchange-heading">
            <div class="hint-row">
              <h2 class="salon-hours-sub" id="salon-hours-exchange-heading">
                Austausch mit anderen Salons
              </h2>
              <InfoHint
                text="Gezählt werden geschlossene, gültige Arbeitszeiten bis zum Stichtag. Eine Aushilfe zählt zu ihrem Stammsalon am Ende des Zeitraums."
                label={hintLabel("Austausch mit anderen Salons")}
                testId="salon-hours-exchange-hint"
              />
            </div>
            <div class="salon-hours-exchange">
              {@render exchange(
                "Aushilfen nach Stammsalon",
                data.exchange.fromOtherSalons,
                "salon-hours-exchange-from",
              )}
              {@render exchange(
                "Stammteam in anderen Salons",
                data.exchange.ownTeamElsewhere,
                "salon-hours-exchange-own",
              )}
            </div>
            {#if canExport}
              <div class="salon-hours-export">
                <button type="button" class="btn btn-outline" onclick={() => onExport?.()}>
                  Als CSV herunterladen
                </button>
              </div>
            {/if}
          </section>
        </aside>
      </div>
    {/if}
  {/if}
</div>

<style>
  /* The block's own container: the aside sits beside the raster from the wide container width of
     the design system (1100 px, ui/breakpoints.ts), below it everything stacks. */
  .salon-hours {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    min-width: 0;
  }

  .salon-hours-layout {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    min-width: 0;
  }

  @container (min-width: 1100px) {
    .salon-hours-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      align-items: start;
      gap: var(--s-5);
    }
  }

  .salon-hours-main,
  .salon-hours-aside {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    min-width: 0;
  }

  .salon-hours-aside {
    gap: var(--s-4);
  }

  .salon-hours-aside .card {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }

  .salon-hours-main-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-1) var(--s-4);
  }

  .salon-hours-title {
    margin: 0;
    font-size: var(--fs-h2);
    font-weight: 600;
    color: var(--text);
  }

  .salon-hours-sub {
    margin: 0;
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text);
  }

  .salon-hours-person {
    display: flex;
    flex-direction: column;
    padding-block: var(--s-1);
    line-height: 1.25;
  }

  .salon-hours-sub-line {
    font-size: var(--fs-sm);
    font-weight: 400;
    color: var(--text-2);
  }

  /* Only the card layout prints it: a person without a day to list gets one calm line there. */
  .salon-hours-none-note {
    display: none;
    font-size: var(--fs-sm);
    font-weight: 400;
    color: var(--text-2);
  }

  /* A cell shows hours, or one chip, or the muted dash; hours and their state chips stack, all on
     the right edge shared with the head and the sum. */
  .salon-hours-cell,
  .salon-hours-cell-button {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--s-1);
    max-width: 100%;
    font-variant-numeric: tabular-nums;
  }

  .salon-hours-cell :global(.chip),
  .salon-hours-cell-button :global(.chip) {
    max-width: 100%;
    height: auto;
    padding-block: 3px;
    line-height: 1.2;
    white-space: normal;
    text-align: start;
  }

  .salon-hours-nil {
    color: var(--text-3);
    font-weight: 400;
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

  /* Card layout of the raster (the DataTable's container is narrower than 760 px): a person card
     lists only the days that have hours or a state, then the sum; empty days and the dash are left
     out, a person without any gets one muted line. */
  @container (max-width: 759.98px) {
    .salon-hours-none-note {
      display: block;
    }

    .salon-hours :global(td:has(> .salon-hours-nil)),
    .salon-hours :global(td:has(> .salon-hours-cell > .salon-hours-nil)),
    .salon-hours :global(td:has(> .salon-hours-cell-button > .salon-hours-nil)) {
      display: none;
    }
  }

  .salon-hours-exchange {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }

  .salon-hours-exchange-part {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
  }

  .salon-hours-exchange-title {
    margin: 0;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-2);
  }

  .salon-hours-exchange-hours {
    font-variant-numeric: tabular-nums;
  }

  .salon-hours-export {
    display: flex;
    justify-content: flex-end;
  }

  .salon-hours-link {
    align-self: flex-start;
    font-size: var(--fs-sm);
    color: var(--brand);
  }

  .salon-hours-calm {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
</style>
