<!--
  BetriebsurlaubPanel - the „Betriebsurlaub“ tab of Verwalten › Regeln › Abwesenheiten (Issue #854, rebuilt on
  the blocks of #843; the data and the endpoints are those of the pre-#854 list). A management section without
  configuration keys of its own (registry section `abwesenheiten-betriebsurlaub`).

  Loads `GET /company-shutdowns?year=` itself, the first time the tab is shown and again when the year changes,
  together with `GET /company-shutdowns/scope` (Issue #1079): what the caller may name (the whole Unternehmen
  and/or which salons). In a Unternehmen with several salons the list shows „Gilt für“ as chips and the create
  dialog offers the scope; a row the caller's reach does not cover (`canManage` false) has no delete action.
  Writes are `POST /company-shutdowns` (a Dialog) and `DELETE /company-shutdowns/:id` (behind a ConfirmDialog);
  each acts at once and answers with a toast (docs/ADMIN_STRUCTURE.md §3.2.1: a list action saves instantly,
  there is no section button). A row opens the shutdown's detail sub-route, where period, notes and exceptions
  are edited. Since Issue #1069 saving really books: the toast after creating names what was booked
  (`bookingSummaryText`), and a delete cancels the bookings of open months. A closed month is never changed by
  either. A refusal of the API (overlap, a run still going) is shown as the server worded it.

  Props:
    active - true while the tab is the selected one
-->
<script lang="ts">
  import { goto } from "$app/navigation";
  import { api, ApiError } from "$api/client";
  import { toasts } from "$stores/toast";
  import { tenantFeatures } from "$stores/tenant-features";
  import { salonContext, shutdownScopeApplies } from "$stores/salon-context";
  import { tenantYear } from "$lib/utils/tenant-day";
  import Chip from "$components/ui/Chip.svelte";
  import ConfirmDialog from "$components/ui/ConfirmDialog.svelte";
  import DataTable, { type DataTableColumn } from "$components/ui/DataTable.svelte";
  import Dialog from "$components/ui/Dialog.svelte";
  import EmptyState from "$components/ui/EmptyState.svelte";
  import ErrorState from "$components/ui/ErrorState.svelte";
  import FormField from "$components/ui/FormField.svelte";
  import Note from "$components/ui/Note.svelte";
  import Skeleton from "$components/ui/Skeleton.svelte";
  import ToggleField from "$lib/components/admin/settings/ToggleField.svelte";
  import {
    createShutdownBody,
    dayCountLabel,
    exceptionCountLabel,
    formatShutdownDate,
    initialShutdownScope,
    isScopeFixed,
    SHUTDOWN_NAME_MAX,
    BOOKING_TOAST_MS,
    bookingToast,
    shutdownFormMessage,
    shutdownSalonIds,
    shutdownSalonLabel,
    shutdownScopeMessage,
    shutdownYears,
    WHOLE_COMPANY_LABEL,
    type CompanyShutdown,
    type ScopeSelection,
    type ShutdownScope,
  } from "$lib/settings/betriebsurlaub";
  import InfoHint, { hintLabel } from "$components/ui/InfoHint.svelte"; // Issue #1058

  interface Props {
    active: boolean;
  }

  let { active }: Props = $props();

  // The scope column only exists in a Unternehmen with several salons (#64).
  const multiSalon = $derived(shutdownScopeApplies($salonContext));
  const columns = $derived<DataTableColumn[]>([
    { key: "name", label: "Bezeichnung", primary: true },
    { key: "period", label: "Zeitraum" },
    ...(multiSalon ? [{ key: "scope", label: "Gilt für" }] : []),
    { key: "deduction", label: "Urlaubskonto" },
    { key: "exceptions", label: "Ausnahmen" },
    { key: "actions", label: "Aktionen", align: "end" as const },
  ]);

  // The tenant's year (Issue #1072), not the device's.
  const years = $derived(shutdownYears(tenantYear(new Date(), $tenantFeatures.timezone)));
  // Seeded from the store's zone (the default until the layout's read settles); the first load
  // re-seeds it once the zone is known, as long as the person has not picked a year.
  const initialYear = String(tenantYear(new Date(), $tenantFeatures.timezone));
  let filterYear = $state(initialYear);

  let shutdowns = $state<CompanyShutdown[]>([]);
  // What the caller may name (Issue #1079); null until the first load answered.
  let scope = $state<ShutdownScope | null>(null);
  let loading = $state(false);
  let loadError = $state("");
  let loaded = false;

  async function loadShutdowns() {
    loading = true;
    loadError = "";
    try {
      // The scope is asked first so the list is the last request (and the year the last query).
      scope = await api.get<ShutdownScope>("/company-shutdowns/scope");
      shutdowns = await api.get<CompanyShutdown[]>(`/company-shutdowns?year=${filterYear}`);
    } catch (err) {
      console.error(err);
      loadError = "Der Betriebsurlaub konnte nicht geladen werden.";
    } finally {
      loading = false;
    }
  }

  // Lazy load on the first visit of the tab.
  $effect(() => {
    if (active && !loaded) {
      loaded = true;
      void (async () => {
        const zone = await tenantFeatures.loadTimezone();
        if (filterYear === initialYear) filterYear = String(tenantYear(new Date(), zone));
        await loadShutdowns();
      })();
    }
  });

  // ── Create ────────────────────────────────────────────────────
  let createOpen = $state(false);
  let name = $state("");
  let startDate = $state("");
  let endDate = $state("");
  let deductsFromVacation = $state(true);
  let notes = $state("");
  let formError = $state("");
  let saving = $state(false);
  let scopeSelection = $state<ScopeSelection>({ mode: "ALL", salonIds: [] });
  // A caller with exactly one reachable salon and no whole-tenant reach cannot choose.
  const scopeFixed = $derived(scope !== null && isScopeFixed(scope));
  const scopeControlShown = $derived(multiSalon && scope !== null);

  function toggleSalon(id: string, checked: boolean) {
    scopeSelection = {
      mode: "SALONS",
      salonIds: checked
        ? [...scopeSelection.salonIds, id]
        : scopeSelection.salonIds.filter((salonId) => salonId !== id),
    };
  }

  function openCreate() {
    scopeSelection = scope ? initialShutdownScope(scope) : { mode: "ALL", salonIds: [] };
    name = "";
    startDate = "";
    endDate = "";
    deductsFromVacation = true;
    notes = "";
    formError = "";
    createOpen = true;
  }

  // Runs inside the Dialog's form: a refusal keeps the dialog open with its text.
  async function saveNew() {
    const message =
      shutdownFormMessage({ name, startDate, endDate }) ??
      (scopeControlShown ? shutdownScopeMessage(scopeSelection) : null);
    if (message !== null) {
      formError = message;
      return;
    }
    saving = true;
    formError = "";
    try {
      const created = await api.post<CompanyShutdown>(
        "/company-shutdowns",
        createShutdownBody({
          name,
          startDate,
          endDate,
          deductsFromVacation,
          notes,
          salonIds: scope ? shutdownSalonIds(scopeSelection, scope, multiSalon) : undefined,
        }),
      );
      const toast = bookingToast(created, "Betriebsurlaub angelegt.");
      toasts.success(toast.message, toast.duration);
      createOpen = false;
      await goto(`/verwalten/regeln/betriebsurlaub/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        formError = err.message;
      } else {
        toasts.error(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
      }
    } finally {
      saving = false;
    }
  }

  // ── Delete ────────────────────────────────────────────────────
  let deleteConfirm = $state<{ open: boolean; id: string | null; name: string }>({
    open: false,
    id: null,
    name: "",
  });

  function askDelete(shutdown: CompanyShutdown) {
    deleteConfirm = { open: true, id: shutdown.id, name: shutdown.name };
  }

  async function confirmDelete() {
    if (!deleteConfirm.id) return;
    try {
      await api.delete(`/company-shutdowns/${deleteConfirm.id}`);
      toasts.success(
        "Betriebsurlaub gelöscht. Gebuchter Urlaub in offenen Monaten ist storniert, abgeschlossene Monate bleiben unverändert.",
        BOOKING_TOAST_MS,
      );
      await loadShutdowns();
    } catch {
      toasts.error(
        "Betriebsurlaub konnte nicht gelöscht werden. Lade die Seite neu und versuche es noch einmal.",
      );
    }
  }

  function open(shutdown: CompanyShutdown) {
    void goto(`/verwalten/regeln/betriebsurlaub/${shutdown.id}`);
  }
</script>

<section class="settings-group" aria-labelledby="abwesenheiten-betriebsurlaub-title">
  <div class="hint-row">
    <h2 class="settings-group-title" id="abwesenheiten-betriebsurlaub-title">Betriebsurlaub</h2>
    <InfoHint
      text="Zeiträume, in denen das Unternehmen oder ausgewählte Salons geschlossen haben. Betroffen ist, wer an dem Tag dort seinen Stammsalon hat. Beim Anlegen wird für diese Mitarbeitenden Urlaub gebucht, soweit Resturlaub da ist. Die übrigen Tage und alle Tage ohne Urlaubsabzug sind bezahlte Freistellung und mindern die Sollzeit wie ein Feiertag. Einzelne Personen nimmst du in der Ansicht des Betriebsurlaubs aus."
      label={hintLabel("Betriebsurlaub")}
    />
  </div>

  <div class="bu-bar">
    <FormField label="Jahr">
      {#snippet field({ id, describedBy })}
        <select
          {id}
          class="form-input bu-year"
          bind:value={filterYear}
          onchange={loadShutdowns}
          aria-describedby={describedBy}
          data-testid="abwesenheiten-betriebsurlaub-year"
        >
          {#each years as year (year)}
            <option value={year}>{year}</option>
          {/each}
        </select>
      {/snippet}
    </FormField>
    <button type="button" class="btn btn-primary" onclick={openCreate}>
      Betriebsurlaub anlegen
    </button>
  </div>

  {#if loadError}
    <ErrorState message={loadError} onRetry={loadShutdowns} retrying={loading} />
  {:else if loading && shutdowns.length === 0}
    <Skeleton shape="card" count={1} lines={4} />
  {:else if shutdowns.length === 0}
    <EmptyState
      icon="calendar"
      title="Keine Betriebsurlaube"
      description={`Für ${filterYear} ist kein Betriebsurlaub angelegt.`}
      actionLabel="Ersten Betriebsurlaub anlegen"
      onaction={openCreate}
    />
  {:else}
    <DataTable
      listId="verwalten.abwesenheiten.betriebsurlaub"
      {columns}
      rows={shutdowns}
      rowKey={(row) => row.id}
      onRowClick={open}
      caption={`Betriebsurlaub ${filterYear} mit Zeitraum, Urlaubskonto und Ausnahmen`}
    >
      {#snippet cell(row, column)}
        {#if column.key === "period"}
          {formatShutdownDate(row.startDate)} – {formatShutdownDate(row.endDate)}
          <span class="bu-days">{dayCountLabel(row.startDate, row.endDate)}</span>
        {:else if column.key === "scope"}
          {#if row.salons.length === 0}
            <Chip tone="neutral">{WHOLE_COMPANY_LABEL}</Chip>
          {:else}
            <span class="bu-chips">
              {#each row.salons as salon (salon.id)}
                <Chip tone={salon.isActive ? "info" : "neutral"}>{shutdownSalonLabel(salon)}</Chip>
              {/each}
            </span>
          {/if}
        {:else if column.key === "deduction"}
          <Chip tone={row.deductsFromVacation ? "warn" : "neutral"}>
            {row.deductsFromVacation ? "Zieht vom Urlaubskonto ab" : "Kein Urlaubsabzug"}
          </Chip>
        {:else if column.key === "exceptions"}
          {#if row.exceptions.length > 0}
            <Chip tone="info">{exceptionCountLabel(row.exceptions.length)}</Chip>
          {:else}
            –
          {/if}
        {:else if column.key === "actions"}
          {#if row.canManage}
            <button
              type="button"
              class="btn btn-secondary btn-sm btn-danger"
              onclick={() => askDelete(row)}
            >
              Löschen
            </button>
          {/if}
        {:else}
          {row.name}
          {#if row.notes}
            <span class="bu-notes">{row.notes}</span>
          {/if}
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</section>

<Dialog bind:open={createOpen} title="Betriebsurlaub anlegen">
  <form
    id="company-shutdown-form"
    novalidate
    class="bu-form"
    onsubmit={(event) => {
      event.preventDefault();
      void saveNew();
    }}
  >
    <FormField label="Bezeichnung" required>
      {#snippet field({ id, describedBy, invalid })}
        <input
          {id}
          class="form-input"
          type="text"
          maxlength={SHUTDOWN_NAME_MAX}
          placeholder="z. B. Weihnachtsschließung 2026"
          bind:value={name}
          data-testid="abwesenheiten-betriebsurlaub-name"
          aria-invalid={invalid ? "true" : undefined}
          aria-describedby={describedBy}
        />
      {/snippet}
    </FormField>
    <div class="bu-dates">
      <FormField label="Startdatum" required>
        {#snippet field({ id, describedBy, invalid })}
          <input
            {id}
            class="form-input"
            type="date"
            bind:value={startDate}
            data-testid="abwesenheiten-betriebsurlaub-start"
            aria-invalid={invalid ? "true" : undefined}
            aria-describedby={describedBy}
          />
        {/snippet}
      </FormField>
      <FormField label="Enddatum" required>
        {#snippet field({ id, describedBy, invalid })}
          <input
            {id}
            class="form-input"
            type="date"
            bind:value={endDate}
            data-testid="abwesenheiten-betriebsurlaub-end"
            aria-invalid={invalid ? "true" : undefined}
            aria-describedby={describedBy}
          />
        {/snippet}
      </FormField>
    </div>
    {#if scopeControlShown && scope}
      <fieldset class="bu-scope">
        <legend class="bu-scope-legend">Gilt für</legend>
        {#if scopeFixed}
          <p class="bu-scope-fixed" data-testid="abwesenheiten-betriebsurlaub-scope-fixed">
            {scope.salons[0].name}
          </p>
        {:else}
          {#if scope.canManageAllSalons}
            <label class="bu-scope-option">
              <input
                type="radio"
                name="bu-scope"
                checked={scopeSelection.mode === "ALL"}
                onchange={() => (scopeSelection = { mode: "ALL", salonIds: [] })}
                data-testid="abwesenheiten-betriebsurlaub-scope-all"
              />
              {WHOLE_COMPANY_LABEL}
            </label>
          {/if}
          <label class="bu-scope-option">
            <input
              type="radio"
              name="bu-scope"
              checked={scopeSelection.mode === "SALONS"}
              onchange={() => (scopeSelection = { ...scopeSelection, mode: "SALONS" })}
              data-testid="abwesenheiten-betriebsurlaub-scope-salons"
            />
            Ausgewählte Salons
          </label>
          {#if scopeSelection.mode === "SALONS"}
            <div class="bu-scope-salons">
              {#each scope.salons as salon (salon.id)}
                <label class="bu-scope-option">
                  <input
                    type="checkbox"
                    checked={scopeSelection.salonIds.includes(salon.id)}
                    onchange={(event) => toggleSalon(salon.id, event.currentTarget.checked)}
                  />
                  {salon.name}
                </label>
              {/each}
            </div>
          {/if}
        {/if}
      </fieldset>
    {/if}
    <ToggleField
      bind:checked={deductsFromVacation}
      label="Vom Urlaubskonto abziehen"
      hint="Mit Urlaubsabzug wird für jede Person Urlaub gebucht, soweit Resturlaub da ist. Die übrigen Tage sind bezahlte Freistellung und mindern die Sollzeit wie ein Feiertag. Ohne Urlaubsabzug sind alle Tage bezahlte Freistellung. Ausgenommene Personen bleiben außen vor."
      testid="abwesenheiten-betriebsurlaub-deducts"
    />
    <FormField label="Notiz">
      {#snippet field({ id, describedBy })}
        <textarea
          {id}
          class="form-input"
          rows="2"
          placeholder="Interne Anmerkung (optional)"
          bind:value={notes}
          data-testid="abwesenheiten-betriebsurlaub-notes"
          aria-describedby={describedBy}
        ></textarea>
      {/snippet}
    </FormField>
    <Note tone="info">
      Mit „Anlegen“ wird der Betriebsurlaub sofort gebucht. Abgeschlossene Monate bleiben
      unverändert.
    </Note>
    {#if formError}
      <div role="alert"><Note tone="bad">{formError}</Note></div>
    {/if}
  </form>
  {#snippet footer()}
    <button type="button" class="btn btn-secondary" onclick={() => (createOpen = false)}>
      Abbrechen
    </button>
    <button type="submit" form="company-shutdown-form" class="btn btn-primary" disabled={saving}>
      {saving ? "Speichern …" : "Anlegen"}
    </button>
  {/snippet}
</Dialog>

<ConfirmDialog
  bind:open={deleteConfirm.open}
  title="Betriebsurlaub löschen?"
  description={`„${deleteConfirm.name}“ wird gelöscht. Gebuchte Urlaubstage in offenen Monaten werden storniert und der Urlaub wird zurückgebucht, abgeschlossene Monate bleiben unverändert. Diese Aktion kann nicht rückgängig gemacht werden.`}
  confirmLabel="Löschen"
  danger
  onConfirm={confirmDelete}
/>

<style>
  .bu-bar {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--s-3);
    margin-bottom: var(--s-3);
  }

  .bu-year {
    width: auto;
    min-width: 6rem;
  }

  .bu-days {
    margin-left: var(--s-2);
    color: var(--text-2);
  }

  .bu-notes {
    display: block;
    margin-top: var(--s-1);
    font-size: var(--fs-sm);
    color: var(--text-2);
  }

  .bu-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
  }

  .bu-scope {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    margin: 0;
    padding: 0;
    border: 0;
  }

  .bu-scope-legend {
    padding: 0;
    margin-bottom: var(--s-1);
    font-weight: 600;
  }

  .bu-scope-option {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }

  .bu-scope-salons {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding-left: var(--s-6);
  }

  .bu-scope-fixed {
    margin: 0;
  }

  .bu-form {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }

  .bu-dates {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: var(--s-4);
  }
</style>
