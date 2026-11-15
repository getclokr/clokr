<!--
  Verwalten › Daten › Export (Issue #593, #854, D-854-12/-13/-22): the one page that STARTS a DATEV export - the
  whole company for a month (`GET /reports/datev`) or one person (`GET /reports/datev/employee`) - and where the
  other files are reachable: the times and absences of a period as CSV (`GET /reports/period/csv`), the
  Monatsexport as PDF (`GET /reports/monthly-export/pdf`) and the iCal files of the leave area.

  Before a month that is not closed is exported, a warning says so (advisory: the API decides, the button stays
  usable). „Letzte Exporte“ lists the company's recent `EXPORT` audit rows in German words (only with
  `audit-log:read`). The DATEV numbers (Berater-, Mandantennummer and the four Lohnarten) are NOT set here any
  more (Issue #951): they live under Verwalten › System › Integrationen › DATEV (registry section
  `export-datev-einrichtung`). This page only shows a hint with a link while the saved Berater- or
  Mandantennummer is missing, and never writes a setting.

  The DATEV file is never narrowed by a salon (§ 41 EStG, CLAUDE.md "Two report documents"): there is no salon
  choice on this page. The rules (hint, history, preselection) live in `$lib/export/export-centre`.
-->
<script lang="ts">
  import { pageLabel } from "$lib/nav/page-labels";
  import { onMount, untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { api } from "$api/client";
  import { downloadFromApi } from "$api/download";
  import { authStore } from "$stores/auth";
  import { toasts } from "$stores/toast";
  import { salonContext, showSalonOptions } from "$stores/salon-context";
  import { hasPermission } from "$lib/permissions";
  import { addMonths, compareMonths } from "$lib/reports/period-state";
  import { periodAbsencesCsvPath, periodCsvPath, type YearMonth } from "$lib/reports/period-report";
  import {
    csvPeriodProblem,
    exportHistoryRows,
    exportPreselection,
    monthName,
    openMonthHint,
    wholeNumberProblem,
    type ExportHistoryRow,
    type ExportLogLike,
  } from "$lib/export/export-centre";
  import PageHead from "$lib/components/layout/PageHead.svelte";
  import Combobox from "$components/ui/Combobox.svelte";
  import FormField from "$components/ui/FormField.svelte";
  import List from "$components/ui/List.svelte";
  import ListRow from "$components/ui/ListRow.svelte";
  import Note from "$components/ui/Note.svelte";
  import PeriodPicker from "$components/ui/PeriodPicker.svelte";
  import Skeleton from "$components/ui/Skeleton.svelte";
  import Spinner from "$components/ui/Spinner.svelte";

  const user = $derived($authStore.user);
  const canReadMonthClose = $derived(hasPermission(user, "month-close:read:ZUGEWIESEN"));
  const canReadAudit = $derived(hasPermission(user, "audit-log:read:ZUGEWIESEN"));
  const canPickPerson = $derived(hasPermission(user, "employee:read:ZUGEWIESEN"));
  const canReadTeamLeave = $derived(hasPermission(user, "leave-request:read:ZUGEWIESEN"));

  // ── The months: browser-local "today" (the API judges by the tenant zone) ──
  const now = new Date();
  const thisMonth: YearMonth = { year: now.getFullYear(), month: now.getMonth() + 1 };
  const lastMonth = addMonths(thisMonth, -1);

  // A link may preselect person and month (`?person=&year=&month=`); every malformed value is dropped.
  const preselection = untrack(() => exportPreselection($page.url));
  const preselectedMonth: YearMonth | null =
    preselection.year !== null && preselection.month !== null
      ? { year: preselection.year, month: preselection.month }
      : null;

  /** The month of the DATEV file and the Monatsexport; never later than the current month. */
  let exportMonth = $state<YearMonth>(
    preselectedMonth !== null && compareMonths(preselectedMonth, thisMonth) <= 0
      ? preselectedMonth
      : lastMonth,
  );
  let personId = $state(preselection.personId ?? "");

  /** The period of the CSV files. */
  let csvFrom = $state<YearMonth>(lastMonth);
  let csvTo = $state<YearMonth>(lastMonth);
  const csvProblem = $derived(csvPeriodProblem(csvFrom, csvTo, thisMonth));

  const mm = (ym: YearMonth) => String(ym.month).padStart(2, "0");

  // ── The hint before an open month ──
  // The status of every month of a year, loaded once per year. Without `month-close:read` (or after a failed
  // read) nothing is requested or shown: there is neither a hint nor an error.
  let statusByYear = $state<Record<number, Record<number, string>>>({});

  async function loadYearStatus(year: number) {
    if (statusByYear[year] !== undefined) return;
    // Claimed first, so a quick second change of month does not request the same year twice.
    statusByYear[year] = {};
    try {
      const res = await api.get<{ months: { month: number; status: string }[] }>(
        `/overtime/close-month/year-status?year=${year}`,
      );
      statusByYear[year] = Object.fromEntries(res.months.map((m) => [m.month, m.status]));
    } catch {
      // Advisory only: the export itself is decided by the API.
    }
  }

  $effect(() => {
    const year = exportMonth.year;
    if (canReadMonthClose) untrack(() => void loadYearStatus(year));
  });

  const monthHint = $derived(
    openMonthHint(
      canReadMonthClose ? statusByYear[exportMonth.year]?.[exportMonth.month] : undefined,
      exportMonth.year,
      exportMonth.month,
    ),
  );

  // ── The downloads ──
  let busy = $state<string | null>(null);

  async function download(key: string, path: string, fallbackFilename: string, done: string) {
    if (busy !== null) return;
    busy = key;
    try {
      await downloadFromApi(path, fallbackFilename);
      toasts.success(done);
      void loadHistory();
    } catch (e: unknown) {
      // A refused export carries a German explanation (e.g. the missing Berater- or Mandantennummer, or the
      // personnel numbers the DATEV format cannot take) - show it, not a status code.
      toasts.error(e instanceof Error ? e.message : "Der Export ist fehlgeschlagen.");
    } finally {
      busy = null;
    }
  }

  const exportYear = $derived(exportMonth.year);

  function exportDatev() {
    return download(
      "datev",
      `/reports/datev?year=${exportMonth.year}&month=${exportMonth.month}`,
      `DATEV_${exportYear}_${mm(exportMonth)}.txt`,
      "Die DATEV-Datei wurde heruntergeladen.",
    );
  }

  function exportDatevPerson() {
    if (personId === "") return;
    return download(
      "datev-person",
      `/reports/datev/employee?employeeId=${encodeURIComponent(personId)}&year=${exportMonth.year}&month=${exportMonth.month}`,
      `DATEV_${exportYear}_${mm(exportMonth)}_Person.txt`,
      "Die DATEV-Datei der Person wurde heruntergeladen.",
    );
  }

  function exportTimesCsv() {
    if (csvProblem !== null) return;
    return download(
      "csv-times",
      periodCsvPath(csvFrom, csvTo, null),
      "zeiten.csv",
      "Die Datei mit den Zeiten wurde heruntergeladen.",
    );
  }

  function exportAbsencesCsv() {
    if (csvProblem !== null) return;
    return download(
      "csv-absences",
      periodAbsencesCsvPath(csvFrom, csvTo, null),
      "abwesenheiten.csv",
      "Die Datei mit den Abwesenheiten wurde heruntergeladen.",
    );
  }

  function exportMonthlyPdf() {
    return download(
      "monthly-pdf",
      `/reports/monthly-export/pdf?year=${exportMonth.year}&month=${exportMonth.month}`,
      `Monatsexport_${exportYear}_${mm(exportMonth)}.pdf`,
      "Das Monatsexport wurde heruntergeladen.",
    );
  }

  function exportIcal(kind: "team" | "personal") {
    return download(
      `ical-${kind}`,
      `/leave/ical/${kind}`,
      kind === "team" ? "clokr-team-abwesenheiten.ics" : "clokr-abwesenheiten.ics",
      "Die Kalenderdatei wurde heruntergeladen.",
    );
  }

  // ── The person for the single-person DATEV file (reach-scoped `GET /employees`) ──
  type PersonOption = { id: string; firstName: string; lastName: string; employeeNumber: string };
  let people = $state<PersonOption[]>([]);

  async function loadPeople() {
    try {
      people = await api.get<PersonOption[]>("/employees");
    } catch {
      // The picker then offers nobody; the whole-company export is unaffected.
      people = [];
    }
  }

  const personItems = $derived.by(() => {
    const items = people
      .map((p) => ({ value: p.id, label: `${p.lastName}, ${p.firstName} (${p.employeeNumber})` }))
      .sort((a, b) => a.label.localeCompare(b.label, "de"));
    // A person named by a link but not in the offered list stays visible.
    if (personId !== "" && !items.some((item) => item.value === personId)) {
      items.push({ value: personId, label: "Ausgewählte Person" });
    }
    return items;
  });

  // ── „Letzte Exporte“ ──
  type Loaded<T> =
    { status: "loading" } | { status: "ready"; data: T } | { status: "failed"; message: string };
  let history = $state<Loaded<ExportHistoryRow[]>>({ status: "loading" });

  async function loadHistory() {
    if (!canReadAudit) return;
    try {
      // The newest 200 EXPORT rows (the list's maximum page), narrowed to this page's kinds by their
      // type code; the list shows the first EXPORT_HISTORY_SIZE of them.
      const res = await api.get<{ logs: ExportLogLike[] }>("/audit-logs?action=EXPORT&limit=200");
      history = { status: "ready", data: exportHistoryRows(res.logs) };
    } catch (e: unknown) {
      history = {
        status: "failed",
        message:
          e instanceof Error ? e.message : "Die letzten Exporte konnten nicht geladen werden.",
      };
    }
  }

  // ── The DATEV numbers (set under System › Integrationen › DATEV, registry section `export-datev-einrichtung`) ──
  // This page only READS the two numbers the export refuses to run without, to show the hint below. A refused
  // read (no settings permission) shows no hint; the API's 409 stays the authority.
  let kanzleiMissing = $state(false);

  async function loadKanzleiHint() {
    try {
      const cfg = await api.get<{
        datevBeraterNr?: number | null;
        datevMandantenNr?: number | null;
      }>("/settings/work");
      kanzleiMissing =
        typeof cfg.datevBeraterNr !== "number" || typeof cfg.datevMandantenNr !== "number";
    } catch {
      kanzleiMissing = false;
    }
  }

  const multiSalon = $derived(showSalonOptions($salonContext));

  onMount(() => {
    // Issue #951: the old anchor of the DATEV setup follows it to System › Integrationen › DATEV.
    if ($page.url.hash === "#datev-einrichtung") {
      void goto("/verwalten/system/integrationen#datev", { replaceState: true });
      return;
    }
    void loadKanzleiHint();
    void loadHistory();
    if (untrack(() => canPickPerson)) void loadPeople();
  });
</script>

<svelte:head>
  <title>{pageLabel("/admin/export")} – Clokr</title>
</svelte:head>

<div data-testid="admin-export-page" style="display: contents;">
  <PageHead
    title={pageLabel("/admin/export")}
    sub="Hier lädst du die Lohndaten für DATEV, Zeiten, Abwesenheiten, das Monatsexport und Kalenderdateien herunter."
  />

  <section class="settings-group" aria-labelledby="export-datev-title">
    <h2 class="settings-group-title" id="export-datev-title">DATEV-Lohnexport</h2>
    <p class="settings-group-desc">
      Die Datei für die Lohnbuchhaltung, für alle Personen eines Monats oder für eine einzelne
      Person.
    </p>

    <PeriodPicker
      label={monthName(exportMonth)}
      eyebrow="Abrechnungsmonat"
      testIdPrefix="export-month"
      prevLabel="Vorheriger Monat"
      nextLabel="Nächster Monat"
      nextDisabled={compareMonths(exportMonth, thisMonth) >= 0}
      onPrev={() => (exportMonth = addMonths(exportMonth, -1))}
      onNext={() => (exportMonth = addMonths(exportMonth, 1))}
    />

    {#if monthHint}
      <div data-testid="export-open-month-hint"><Note tone="warn">{monthHint}</Note></div>
    {/if}
    {#if kanzleiMissing}
      <div data-testid="export-kanzlei-missing">
        <Note tone="warn">
          Berater-Nr. und Mandantennummer fehlen. Der DATEV-Export wird abgelehnt, bis beide unter
          <a href="/verwalten/system/integrationen#datev">System › Integrationen › DATEV</a> hinterlegt
          sind.
        </Note>
      </div>
    {/if}

    <div class="export-actions">
      <button
        type="button"
        class="btn btn-primary"
        onclick={exportDatev}
        disabled={busy !== null}
        data-testid="export-datev"
      >
        {#if busy === "datev"}<Spinner size={14} label="Datei wird erstellt" />{/if}
        Alle Personen exportieren
      </button>
    </div>

    {#if canPickPerson}
      <FormField
        label="Einzelne Person"
        help="Die Datei enthält nur diese Person im gewählten Monat."
      >
        {#snippet field({ id, describedBy })}
          <Combobox
            items={personItems}
            bind:value={personId}
            label="Einzelne Person"
            placeholder="Person wählen"
            {id}
            {describedBy}
          />
        {/snippet}
      </FormField>
      <div class="export-actions">
        <button
          type="button"
          class="btn btn-outline"
          onclick={exportDatevPerson}
          disabled={busy !== null || personId === ""}
          data-testid="export-datev-person"
        >
          {#if busy === "datev-person"}<Spinner size={14} label="Datei wird erstellt" />{/if}
          Person exportieren
        </button>
      </div>
    {:else}
      <Note tone="info">
        Um die Datei einer einzelnen Person zu erstellen, musst du Personen sehen dürfen.
      </Note>
    {/if}
  </section>

  <section class="settings-group" aria-labelledby="export-csv-title">
    <h2 class="settings-group-title" id="export-csv-title">Zeiten und Abwesenheiten (CSV)</h2>
    <p class="settings-group-desc">
      Eine Zeile pro Person für den gewählten Zeitraum, höchstens 12 Monate, mit Semikolon getrennt.
    </p>

    <div class="export-periods">
      <PeriodPicker
        label={monthName(csvFrom)}
        eyebrow="Von"
        testIdPrefix="export-csv-from"
        prevLabel="Vorheriger Monat (Von)"
        nextLabel="Nächster Monat (Von)"
        nextDisabled={compareMonths(csvFrom, thisMonth) >= 0}
        onPrev={() => (csvFrom = addMonths(csvFrom, -1))}
        onNext={() => (csvFrom = addMonths(csvFrom, 1))}
      />
      <PeriodPicker
        label={monthName(csvTo)}
        eyebrow="Bis"
        testIdPrefix="export-csv-to"
        prevLabel="Vorheriger Monat (Bis)"
        nextLabel="Nächster Monat (Bis)"
        nextDisabled={compareMonths(csvTo, thisMonth) >= 0}
        onPrev={() => (csvTo = addMonths(csvTo, -1))}
        onNext={() => (csvTo = addMonths(csvTo, 1))}
      />
    </div>
    {#if csvProblem}
      <div role="alert"><Note tone="bad">{csvProblem}</Note></div>
    {/if}

    <div class="export-actions">
      <button
        type="button"
        class="btn btn-outline"
        onclick={exportTimesCsv}
        disabled={busy !== null || csvProblem !== null}
        data-testid="export-csv-times"
      >
        {#if busy === "csv-times"}<Spinner size={14} label="Datei wird erstellt" />{/if}
        Zeiten als CSV
      </button>
      <button
        type="button"
        class="btn btn-outline"
        onclick={exportAbsencesCsv}
        disabled={busy !== null || csvProblem !== null}
        data-testid="export-csv-absences"
      >
        {#if busy === "csv-absences"}<Spinner size={14} label="Datei wird erstellt" />{/if}
        Abwesenheiten als CSV
      </button>
    </div>
  </section>

  <section class="settings-group" aria-labelledby="export-pdf-title">
    <h2 class="settings-group-title" id="export-pdf-title">Monatsexport (PDF)</h2>
    <p class="settings-group-desc">
      Die lesbare Fassung des DATEV-Exports: alle Personen eines Monats, ohne Tagesliste. Der Monat
      ist der Abrechnungsmonat von oben ({monthName(exportMonth)}).
    </p>
    {#if multiSalon}
      <Note tone="info">
        Das Monatsexport enthält alle Salons. Für einen einzelnen Salon exportierst du es unter
        <a href="/team/berichte">{pageLabel("/reports")}</a>.
      </Note>
    {/if}
    <div class="export-actions">
      <button
        type="button"
        class="btn btn-outline"
        onclick={exportMonthlyPdf}
        disabled={busy !== null}
        data-testid="export-monthly-pdf"
      >
        {#if busy === "monthly-pdf"}<Spinner size={14} label="Datei wird erstellt" />{/if}
        Monatsexport herunterladen
      </button>
    </div>
  </section>

  <section class="settings-group" aria-labelledby="export-ical-title">
    <h2 class="settings-group-title" id="export-ical-title">Kalender (iCal)</h2>
    <p class="settings-group-desc">
      Abwesenheiten als Kalenderdatei für Outlook, Google Kalender oder Apple Kalender.
    </p>
    <div class="export-actions">
      {#if canReadTeamLeave}
        <button
          type="button"
          class="btn btn-outline"
          onclick={() => exportIcal("team")}
          disabled={busy !== null}
          data-testid="export-ical-team"
        >
          {#if busy === "ical-team"}<Spinner size={14} label="Datei wird erstellt" />{/if}
          Team-Abwesenheiten
        </button>
      {/if}
      <button
        type="button"
        class="btn btn-outline"
        onclick={() => exportIcal("personal")}
        disabled={busy !== null}
        data-testid="export-ical-personal"
      >
        {#if busy === "ical-personal"}<Spinner size={14} label="Datei wird erstellt" />{/if}
        Meine Abwesenheiten
      </button>
    </div>
  </section>

  <section class="settings-group" aria-labelledby="export-history-title">
    <h2 class="settings-group-title" id="export-history-title">Letzte Exporte</h2>
    <p class="settings-group-desc">Die 20 neuesten Exporte deines Unternehmens.</p>
    {#if !canReadAudit}
      <Note tone="info">Die letzten Exporte siehst du mit dem Recht, das Protokoll zu lesen.</Note>
    {:else if history.status === "loading"}
      <Skeleton shape="row" count={3} />
    {:else if history.status === "failed"}
      <div role="alert"><Note tone="bad">{history.message}</Note></div>
    {:else if history.data.length === 0}
      <Note tone="info">Es gibt noch keinen Export.</Note>
    {:else}
      <List ariaLabel="Letzte Exporte">
        {#each history.data as row (row.id)}
          <ListRow title={row.kind} subtitle={row.scope} avatar={false}>
            {#snippet trailing()}
              <span class="export-when">{row.when} · {row.who}</span>
            {/snippet}
          </ListRow>
        {/each}
      </List>
    {/if}
  </section>
</div>

<style>
  .export-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }

  .export-periods {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-3);
  }

  .export-when {
    font-size: var(--fs-sm);
    color: var(--text-2);
    white-space: nowrap;
  }
</style>
