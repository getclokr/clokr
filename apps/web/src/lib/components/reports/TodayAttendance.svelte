<script lang="ts">
  // Issue #612 (ADD-1, owner decision 1, UI-SPEC "Tab Heute") - the former „Heutige Anwesenheit“
  // card of /reports: the summary, the list with the words of the one status vocabulary (#587), the
  // two action links of a „Fehlt“ row, the salon badge (#542) and the pagination. Rebuilt on the
  // blocks for Issue #854: a KpiStrip for the summary, a DataTable for the list, a Chip per status.
  // Today's state has no period. The page loads the data (and wires the salon); this component
  // renders what it is given.
  import Chip, { type ChipTone } from "$components/ui/Chip.svelte";
  import DataTable, { type DataTableColumn } from "$components/ui/DataTable.svelte";
  import KpiStrip, { type KpiItem } from "$components/ui/KpiStrip.svelte";
  import Note from "$components/ui/Note.svelte";
  import Skeleton from "$components/ui/Skeleton.svelte";
  import SalonScopeLabel from "$lib/components/team/SalonScopeLabel.svelte"; // Issue #542
  import { DAY_STATUS_LABEL, attendanceStatusText } from "$lib/dashboard/day-status-label"; // Issue #587
  import { teamDayHref, teamLeaveCreateHref } from "$lib/dashboard/team-day-links"; // Issue #587
  import { fmtDateDe } from "$lib/reports/period-format";
  import InfoHint, { hintLabel } from "$components/ui/InfoHint.svelte"; // Issue #1058
  import type { TodayAttendanceData, TodayEmployee } from "$lib/reports/today-attendance";

  interface Props {
    /** The answer of `GET /dashboard/today-attendance`; null until the first one. */
    attendance: TodayAttendanceData | null;
    loading: boolean;
    /** The load failed (the server's or a generic message); empty when it did not. */
    error: string;
    /** The server answered the one 404 for the chosen salon. */
    rejected: boolean;
    // Issue #587 (D-587-4): the two action links of a „Fehlt“ row; the target pages and the API
    // enforce their own rules, these only decide whether the link is offered.
    canAddTeamEntry: boolean;
    canRecordTeamAbsence: boolean;
  }

  let { attendance, loading, error, rejected, canAddTeamEntry, canRecordTeamAbsence }: Props =
    $props();

  const showAttendanceActions = $derived(canAddTeamEntry || canRecordTeamAbsence);

  // Issue #992 (D-992-03): the action column exists only when at least one row offers an action - a
  // „Fehlt“ row with a day link the rights allow. Otherwise it was an empty column of headings.
  const hasActionRows = $derived(
    showAttendanceActions &&
      (attendance?.employees ?? []).some(
        (row) =>
          row.status === "missing" &&
          ((canAddTeamEntry && teamDayHref(row.id, attendance?.date ?? "") !== null) ||
            (canRecordTeamAbsence && teamLeaveCreateHref(row.id, attendance?.date ?? "") !== null)),
      ),
  );

  const summaryItems = $derived.by((): KpiItem[] => {
    if (attendance === null) return [];
    const { summary } = attendance;
    const items: KpiItem[] = [
      { label: "Anwesend", value: summary.present },
      { label: "Eingestempelt", value: summary.clockedIn },
      { label: "Abwesend", value: summary.absent },
      { label: DAY_STATUS_LABEL.missing, value: summary.missing },
    ];
    if (summary.holiday > 0) items.push({ label: "Feiertag", value: summary.holiday });
    return items;
  });

  const columns = $derived<DataTableColumn[]>([
    { key: "name", label: "Person", primary: true },
    { key: "employeeNumber", label: "Nr." },
    { key: "status", label: "Status" },
    ...(hasActionRows ? [{ key: "actions", label: "Aktionen", align: "end" as const }] : []),
  ]);

  // The status vocabulary stays the API's (#587); the chip only picks the tone.
  const STATUS_TONE: Record<TodayEmployee["status"], ChipTone> = {
    present: "ok",
    clocked_in: "ok",
    absent: "warn",
    requested: "warn",
    holiday: "brand",
    missing: "bad",
    scheduled: "neutral",
    none: "neutral",
  };
</script>

<section class="settings-group" aria-labelledby="today-attendance-title">
  <div class="hint-row">
    <h2 class="settings-group-title" id="today-attendance-title">Heutige Anwesenheit</h2>
    <InfoHint
      text="Stand heute, unabhängig vom Zeitraum"
      label={hintLabel("Heutige Anwesenheit")}
    />
  </div>
  <!-- The date is data, not explanation (Issue #1058): it stays visible. -->
  {#if attendance}
    <p class="settings-group-desc">
      <span class="attendance-date">{fmtDateDe(attendance.date)}</span>
    </p>
  {/if}

  {#if loading}
    <Skeleton shape="row" count={4} />
  {:else if rejected}
    <SalonScopeLabel label={null} rejected={true} />
  {:else if error}
    <div role="alert">
      <Note tone="bad">{error}</Note>
    </div>
  {:else if attendance}
    <KpiStrip items={summaryItems} ariaLabel="Anwesenheit heute" />

    <DataTable
      listId="team.berichte.anwesenheit-heute"
      {columns}
      rows={attendance.employees}
      pageResetKey={attendance.employees.length}
      rowKey={(row) => row.id}
      cell={attendanceCell}
      caption="Anwesenheit heute"
    />
  {/if}
</section>

{#snippet attendanceCell(row: TodayEmployee, column: DataTableColumn)}
  {#if column.key === "name"}
    {row.name}
  {:else if column.key === "employeeNumber"}
    {row.employeeNumber}
  {:else if column.key === "status"}
    {#if row.status === "none"}
      <!-- #992 N-14: „—“ in a chip is no status; nobody planned this person, so it is quiet text. -->
      <span class="ta-quiet">Nicht eingeplant</span>
    {:else}
      <Chip tone={STATUS_TONE[row.status]}>{attendanceStatusText(row)}</Chip>
    {/if}
    {#if row.workedElsewhere}
      <Chip tone="neutral" title="In einem anderen Salon gearbeitet">anderer Salon</Chip>
    {/if}
  {:else if column.key === "actions"}
    <div class="row-actions__group">
      {#if row.status === "missing" && attendance !== null}
        {@const entryHref = teamDayHref(row.id, attendance.date)}
        {@const absenceHref = teamLeaveCreateHref(row.id, attendance.date)}
        {#if canAddTeamEntry && entryHref !== null}
          <a class="btn btn-ghost" href={entryHref}>Zeit nachtragen</a>
        {/if}
        {#if canRecordTeamAbsence && absenceHref !== null}
          <a class="btn btn-ghost" href={absenceHref}>Abwesenheit eintragen</a>
        {/if}
      {/if}
    </div>
  {/if}
{/snippet}

<style>
  .ta-quiet {
    color: var(--text-2);
  }

  .attendance-date {
    color: var(--text);
    font-weight: 600;
  }

  /* Issue #587 / #442: the flex layout of the action links lives on this inner wrapper, never on
     the td itself, so the cell keeps display: table-cell and lines up with the rest of the row. */
  .row-actions__group {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    justify-content: flex-end;
    flex-wrap: wrap;
  }
</style>
