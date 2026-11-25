<script lang="ts">
  import { showDetailCrumb } from "$lib/nav/detail-crumb";
  import { pageLabel } from "$lib/nav/page-labels";
  import { api, ApiError } from "$api/client";
  import { toasts } from "$stores/toast";
  import { markUnsaved } from "$stores/unsaved";
  import { salonContext } from "$stores/salon-context";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import PageHead from "$lib/components/layout/PageHead.svelte";
  import Chip from "$components/ui/Chip.svelte";
  import ConfirmDialog from "$components/ui/ConfirmDialog.svelte";
  import DataTable, { type DataTableColumn } from "$components/ui/DataTable.svelte";
  import Dialog from "$components/ui/Dialog.svelte";
  import EmptyState from "$components/ui/EmptyState.svelte";
  import FormField from "$components/ui/FormField.svelte";
  import Note from "$components/ui/Note.svelte";
  import Skeleton from "$components/ui/Skeleton.svelte";
  import SettingsGroup from "$lib/components/admin/settings/SettingsGroup.svelte";
  import ToggleField from "$lib/components/admin/settings/ToggleField.svelte";
  import {
    SHUTDOWN_NAME_MAX,
    dayCountLabel,
    formatShutdownDate,
    shutdownFieldMessages,
    BOOKING_TOAST_MS,
    bookingToast,
    sameScope,
    scopeSelectionOf,
    shutdownSalonLabel,
    shutdownScopeMessage,
    WHOLE_COMPANY_LABEL,
    type CompanyShutdown,
    type ScopeSelection,
    type ShutdownEmployee,
    type ShutdownException,
    type ShutdownScope,
  } from "$lib/settings/betriebsurlaub";
  import InfoHint, { hintLabel } from "$components/ui/InfoHint.svelte"; // Issue #1058

  // ── Loading state ──────────────────────────────────────────────────────────
  let loading = $state(true);
  let loadError = $state("");

  // ── Data state ─────────────────────────────────────────────────────────────
  let shutdown = $state<CompanyShutdown | null>(null);
  // The shutdown's name closes the top bar's path (#854: pages carry no breadcrumb of their own).
  $effect(() => showDetailCrumb(shutdown?.name ?? null));
  let allEmployees = $state<ShutdownEmployee[]>([]);
  // What the caller may name (Issue #1079); loaded only for a row the caller can manage.
  let scope = $state<ShutdownScope | null>(null);
  // A row the caller's reach does not cover is shown read-only (Issue #1079).
  const readOnly = $derived(shutdown !== null && !shutdown.canManage);
  const multiSalon = $derived($salonContext.isMultiSalon);

  const shutdownId = $derived(page.params.id);

  onMount(async () => {
    loading = true;
    loadError = "";
    try {
      const [shutdownsRes, employeesRes, scopeRes] = await Promise.allSettled([
        api.get<CompanyShutdown[]>("/company-shutdowns"),
        api.get<{ employees?: ShutdownEmployee[] } | ShutdownEmployee[]>("/employees?limit=500"),
        api.get<ShutdownScope>("/company-shutdowns/scope"),
      ]);

      if (shutdownsRes.status === "rejected") {
        loadError = "Der Betriebsurlaub konnte nicht geladen werden.";
        return;
      }
      const found = shutdownsRes.value.find((s) => s.id === shutdownId);
      if (!found) {
        loadError = "Betriebsurlaub nicht gefunden.";
        return;
      }
      shutdown = found;
      formName = found.name;
      formStart = found.startDate.slice(0, 10);
      formEnd = found.endDate.slice(0, 10);
      formDeducts = found.deductsFromVacation;
      formNotes = found.notes ?? "";
      formScope = scopeSelectionOf(found.salons);
      if (scopeRes.status === "fulfilled" && found.canManage) scope = scopeRes.value;

      shutdownSnapshot = snap(formName, formStart, formEnd, formDeducts, formNotes, formScope);
      snapshotsReady = true;

      if (employeesRes.status === "fulfilled") {
        const d = employeesRes.value;
        allEmployees = (Array.isArray(d) ? d : d.employees) ?? [];
      }
    } catch {
      loadError = "Der Betriebsurlaub konnte nicht geladen werden.";
    } finally {
      loading = false;
    }
  });

  // ── State ──────────────────────────────────────────────────────────────────
  let saving = $state(false);
  let saveError = $state("");

  // Edit form fields
  let formName = $state("");
  let formStart = $state("");
  let formEnd = $state("");
  let formDeducts = $state(false);
  let formNotes = $state("");
  let formScope = $state<ScopeSelection>({ mode: "ALL", salonIds: [] });

  function toggleScopeSalon(id: string, checked: boolean) {
    formScope = {
      mode: "SALONS",
      salonIds: checked
        ? [...formScope.salonIds, id]
        : formScope.salonIds.filter((salonId) => salonId !== id),
    };
  }

  // ── Unsaved-section tracking (Phase 109, D-11/D-12 · AK-06/AK-07) ──────────────
  // Snapshot comparison rather than per-field oninput flags - same idiom as admin/system.
  function snap(...values: unknown[]): string {
    return JSON.stringify(values);
  }

  let shutdownSnapshot = $state("");
  let shutdownDirty = $derived(
    snap(formName, formStart, formEnd, formDeducts, formNotes, formScope) !== shutdownSnapshot,
  );

  // The number of fields that differ from the snapshot (the SaveBar's "N Änderungen").
  const shutdownChanges = $derived.by(() => {
    if (shutdownSnapshot === "") return 0;
    const stored = JSON.parse(shutdownSnapshot) as unknown[];
    return [formName, formStart, formEnd, formDeducts, formNotes, formScope].filter(
      (value, index) =>
        index === 5
          ? !sameScope(value as ScopeSelection, stored[5] as ScopeSelection)
          : value !== stored[index],
    ).length;
  });

  const messages = $derived(
    shutdownFieldMessages({ name: formName, startDate: formStart, endDate: formEnd }),
  );
  // The salon scope needs at least one salon once „Ausgewählte Salons“ is chosen.
  const scopeMessage = $derived(scope ? shutdownScopeMessage(formScope) : null);
  const shutdownErrors = $derived(
    Object.values(messages).filter((m) => m !== "").length + (scopeMessage ? 1 : 0),
  );

  // Gate the registration on "the baseline has been taken" (WR-01). onMount returns early on a
  // failed load AND on a not-found id, both before any field is hydrated - registering an ungated
  // dirty flag would arm the navigation guard on a page that shows nothing but an error.
  let snapshotsReady = $state(false);

  $effect(() => {
    markUnsaved("admin-shutdown-detail", snapshotsReady && shutdownDirty);
    return () => markUnsaved("admin-shutdown-detail", false);
  });

  // Delete confirm
  let deleteConfirmOpen = $state(false);

  // Exceptions are instant writes from a Dialog and a ConfirmDialog; their drafts are a dialog-dismissal
  // concern that beforeNavigate never sees, so only the period section is tracked above.
  let exceptionDialogOpen = $state(false);
  let addExceptionEmpId = $state("");
  let addExceptionReason = $state("");
  let savingException = $state(false);
  let removeConfirm = $state<{ open: boolean; employeeId: string | null; name: string }>({
    open: false,
    employeeId: null,
    name: "",
  });

  const exceptionColumns: DataTableColumn[] = [
    { key: "person", label: "Mitarbeitende", primary: true },
    { key: "number", label: "Nr." },
    { key: "reason", label: "Grund" },
    { key: "actions", label: "Aktionen", align: "end" },
  ];

  // ── Reload ─────────────────────────────────────────────────────────────────
  async function reloadShutdown() {
    if (!shutdown) return;
    try {
      const all = await api.get<CompanyShutdown[]>("/company-shutdowns");
      const updated = all.find((s) => s.id === shutdown!.id);
      if (updated) shutdown = updated;
    } catch {
      toasts.error("Die Ausnahmen konnten nicht neu geladen werden. Lade die Seite neu.");
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function saveShutdown() {
    if (!shutdown) return;
    if (shutdownErrors > 0) {
      saveError = "Bitte prüf die markierten Felder.";
      return;
    }
    saving = true;
    saveError = "";
    try {
      // Only a changed scope sends `salonIds` (an empty list means the whole Unternehmen).
      const scopeChanged = !sameScope(formScope, scopeSelectionOf(shutdown.salons));
      const updated = await api.patch<CompanyShutdown>(`/company-shutdowns/${shutdown.id}`, {
        name: formName.trim(),
        startDate: formStart,
        endDate: formEnd,
        deductsFromVacation: formDeducts,
        notes: formNotes,
        ...(scopeChanged
          ? { salonIds: formScope.mode === "ALL" ? [] : [...formScope.salonIds] }
          : {}),
      });
      // Only a changed period or deduction books again; for a name or note the API answers empty counts,
      // which must not read as "nobody is affected".
      const rebooked =
        formStart !== shutdown.startDate.slice(0, 10) ||
        formEnd !== shutdown.endDate.slice(0, 10) ||
        formDeducts !== shutdown.deductsFromVacation ||
        scopeChanged;
      shutdown = updated;
      shutdownSnapshot = snap(formName, formStart, formEnd, formDeducts, formNotes, formScope); // the section is clean again
      const toast = bookingToast(rebooked ? updated : {}, "Betriebsurlaub gespeichert.");
      toasts.success(toast.message, toast.duration);
    } catch (err) {
      // A refusal of the API is shown as the server worded it.
      saveError =
        err instanceof ApiError && err.status >= 400 && err.status < 500
          ? err.message
          : "Speichern fehlgeschlagen.";
    } finally {
      saving = false;
    }
  }

  function discardShutdown() {
    const stored = JSON.parse(shutdownSnapshot) as [
      string,
      string,
      string,
      boolean,
      string,
      ScopeSelection,
    ];
    [formName, formStart, formEnd, formDeducts, formNotes, formScope] = stored;
    saveError = "";
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function confirmDelete() {
    if (!shutdown) return;
    try {
      await api.delete(`/company-shutdowns/${shutdown.id}`);
      toasts.success(
        "Betriebsurlaub gelöscht. Gebuchter Urlaub in offenen Monaten ist storniert, abgeschlossene Monate bleiben unverändert.",
        BOOKING_TOAST_MS,
      );
      // The shutdown is gone: leave without the unsaved guard asking about the form.
      shutdownSnapshot = snap(formName, formStart, formEnd, formDeducts, formNotes, formScope);
      await goto("/verwalten/regeln/abwesenheiten#betriebsurlaub");
    } catch {
      toasts.error("Löschen fehlgeschlagen. Versuche es noch einmal.");
    }
  }

  // ── Exceptions ─────────────────────────────────────────────────────────────
  function openExceptions() {
    addExceptionEmpId = "";
    addExceptionReason = "";
    exceptionDialogOpen = true;
  }

  async function addException() {
    if (!shutdown || !addExceptionEmpId) return;
    savingException = true;
    try {
      await api.post(`/company-shutdowns/${shutdown.id}/exceptions`, {
        employeeId: addExceptionEmpId,
        reason: addExceptionReason || undefined,
      });
      exceptionDialogOpen = false;
      toasts.success(
        "Ausnahme hinzugefügt. Gebuchte Tage der Person in offenen Monaten sind storniert, sie arbeitet normal.",
        BOOKING_TOAST_MS,
      );
      await reloadShutdown();
    } catch {
      toasts.error(
        "Ausnahme konnte nicht hinzugefügt werden. Prüfe die Auswahl und versuche es noch einmal.",
      );
    } finally {
      savingException = false;
    }
  }

  function askRemoveException(ex: ShutdownException) {
    removeConfirm = {
      open: true,
      employeeId: ex.employeeId,
      name: `${ex.employee.firstName} ${ex.employee.lastName}`,
    };
  }

  async function confirmRemoveException() {
    if (!shutdown || !removeConfirm.employeeId) return;
    try {
      await api.delete(`/company-shutdowns/${shutdown.id}/exceptions/${removeConfirm.employeeId}`);
      toasts.success(
        "Ausnahme entfernt. Der Betriebsurlaub gilt für die Person wieder und wird in offenen Monaten gebucht.",
        BOOKING_TOAST_MS,
      );
      await reloadShutdown();
    } catch {
      toasts.error("Ausnahme konnte nicht entfernt werden. Versuche es noch einmal.");
    }
  }

  const availableEmployees = $derived(
    shutdown
      ? allEmployees.filter((e) => !shutdown!.exceptions.some((ex) => ex.employeeId === e.id))
      : [],
  );
</script>

<svelte:head>
  <title>{shutdown ? shutdown.name : pageLabel("/admin/shutdowns")} – Clokr</title>
</svelte:head>

{#if loading}
  <Skeleton shape="card" count={2} lines={3} />
{:else if loadError || !shutdown}
  <div role="alert"><Note tone="bad">{loadError || "Betriebsurlaub nicht gefunden."}</Note></div>
{:else}
  <!-- A snippet body loses the `!shutdown` narrowing of the branch above, so it reads this const. -->
  {@const shownShutdown = shutdown}
  <PageHead
    title={shownShutdown.name}
    sub={`${formatShutdownDate(shownShutdown.startDate)} – ${formatShutdownDate(shownShutdown.endDate)} (${dayCountLabel(shownShutdown.startDate, shownShutdown.endDate)})`}
  >
    {#snippet actions()}
      {#if multiSalon}
        {#if shownShutdown.salons.length === 0}
          <Chip tone="neutral">{WHOLE_COMPANY_LABEL}</Chip>
        {:else}
          {#each shownShutdown.salons as salon (salon.id)}
            <Chip tone={salon.isActive ? "info" : "neutral"}>{shutdownSalonLabel(salon)}</Chip>
          {/each}
        {/if}
      {/if}
      <Chip tone={shownShutdown.deductsFromVacation ? "warn" : "neutral"}>
        {shownShutdown.deductsFromVacation ? "Zieht vom Urlaubskonto ab" : "Kein Urlaubsabzug"}
      </Chip>
    {/snippet}
  </PageHead>

  <div class="sd-stack">
    {#if readOnly}
      <Note tone="info">
        Diesen Betriebsurlaub verwaltet, wer für alle seine Salons oder für das ganze Unternehmen
        zuständig ist; ohne Urlaubsabzug (bezahlte Freistellung) nur, wer für das ganze Unternehmen
        zuständig ist. Du kannst ihn ansehen, aber nicht ändern.
      </Note>
    {/if}
    <!-- ── Zeitraum und Einstellungen ───────────────────────────────────────── -->
    <SettingsGroup
      title="Zeitraum und Einstellungen"
      hint="Bezeichnung, Zeitraum und ob der Betriebsurlaub vom Urlaubskonto abgezogen wird."
      changes={shutdownChanges}
      errors={shutdownErrors}
      {saving}
      saveLabel="Betriebsurlaub speichern"
      onSave={saveShutdown}
      onDiscard={discardShutdown}
    >
      <FormField label="Bezeichnung" required error={messages.name}>
        {#snippet field({ id, describedBy, invalid })}
          <input
            {id}
            class="form-input"
            type="text"
            maxlength={SHUTDOWN_NAME_MAX}
            placeholder="z. B. Weihnachtsschließung 2026"
            bind:value={formName}
            disabled={saving || readOnly}
            data-testid="shutdown-name"
            aria-invalid={invalid ? "true" : undefined}
            aria-describedby={describedBy}
          />
        {/snippet}
      </FormField>
      <div class="sd-dates">
        <FormField label="Startdatum" required error={messages.startDate}>
          {#snippet field({ id, describedBy, invalid })}
            <input
              {id}
              class="form-input"
              type="date"
              bind:value={formStart}
              disabled={saving || readOnly}
              data-testid="shutdown-start"
              aria-invalid={invalid ? "true" : undefined}
              aria-describedby={describedBy}
            />
          {/snippet}
        </FormField>
        <FormField label="Enddatum" required error={messages.endDate}>
          {#snippet field({ id, describedBy, invalid })}
            <input
              {id}
              class="form-input"
              type="date"
              bind:value={formEnd}
              disabled={saving || readOnly}
              data-testid="shutdown-end"
              aria-invalid={invalid ? "true" : undefined}
              aria-describedby={describedBy}
            />
          {/snippet}
        </FormField>
      </div>
      {#if multiSalon && scope && !readOnly}
        <fieldset class="sd-scope" data-testid="shutdown-scope">
          <legend class="sd-scope-legend">Gilt für</legend>
          {#if scope.canManageAllSalons}
            <label class="sd-scope-option">
              <input
                type="radio"
                name="sd-scope"
                checked={formScope.mode === "ALL"}
                disabled={saving}
                onchange={() => (formScope = { mode: "ALL", salonIds: [] })}
              />
              {WHOLE_COMPANY_LABEL}
            </label>
          {/if}
          <label class="sd-scope-option">
            <input
              type="radio"
              name="sd-scope"
              checked={formScope.mode === "SALONS"}
              disabled={saving}
              onchange={() => (formScope = { ...formScope, mode: "SALONS" })}
            />
            Ausgewählte Salons
          </label>
          {#if formScope.mode === "SALONS"}
            <div class="sd-scope-salons">
              {#each scope.salons as salon (salon.id)}
                <label class="sd-scope-option">
                  <input
                    type="checkbox"
                    checked={formScope.salonIds.includes(salon.id)}
                    disabled={saving}
                    onchange={(event) => toggleScopeSalon(salon.id, event.currentTarget.checked)}
                  />
                  {salon.name}
                </label>
              {/each}
              {#each shownShutdown.salons.filter((salon) => !scope!.salons.some((s) => s.id === salon.id)) as kept (kept.id)}
                <!-- A stored salon outside the choice (deactivated) stays in the scope as it is. -->
                <label class="sd-scope-option">
                  <input
                    type="checkbox"
                    checked={formScope.salonIds.includes(kept.id)}
                    disabled={saving}
                    onchange={(event) => toggleScopeSalon(kept.id, event.currentTarget.checked)}
                  />
                  {shutdownSalonLabel(kept)}
                </label>
              {/each}
            </div>
          {/if}
          {#if scopeMessage}
            <div role="alert"><Note tone="bad">{scopeMessage}</Note></div>
          {/if}
          <p class="sd-scope-hint">
            Wechselst du die Auswahl, werden die offenen Monate neu gebucht.
          </p>
        </fieldset>
      {/if}
      <ToggleField
        bind:checked={formDeducts}
        label="Vom Urlaubskonto abziehen"
        hint="Mit Urlaubsabzug wird für jede Person Urlaub gebucht, soweit Resturlaub da ist. Die übrigen Tage sind bezahlte Freistellung und mindern die Sollzeit wie ein Feiertag. Ohne Urlaubsabzug sind alle Tage bezahlte Freistellung. Ausgenommene Personen bleiben außen vor."
        disabled={saving || readOnly}
        testid="shutdown-deducts"
      />
      <FormField label="Notiz">
        {#snippet field({ id, describedBy })}
          <textarea
            {id}
            class="form-input"
            rows="3"
            placeholder="Interne Anmerkung (optional)"
            bind:value={formNotes}
            disabled={saving || readOnly}
            data-testid="shutdown-notes"
            aria-describedby={describedBy}
          ></textarea>
        {/snippet}
      </FormField>
      <Note tone="info">
        Ändert sich der Zeitraum oder der Urlaubsabzug, werden die offenen Monate neu gebucht.
        Abgeschlossene Monate bleiben unverändert, korrigiere sie über eine Monatskorrektur.
      </Note>
      {#if saveError}
        <div role="alert"><Note tone="bad">{saveError}</Note></div>
      {/if}
    </SettingsGroup>

    <!-- ── Ausnahmen ──────────────────────────────────────────────────────────── -->
    <section class="settings-group" aria-labelledby="shutdown-exceptions-title">
      <div class="hint-row">
        <h2 class="settings-group-title" id="shutdown-exceptions-title">Ausnahmen</h2>
        <InfoHint
          text="Mitarbeitende in dieser Liste sind vom Betriebsurlaub ausgenommen. Die Personen arbeiten normal, ihre Sollzeit bleibt und ihr Urlaubskonto wird nicht belastet."
          label={hintLabel("Ausnahmen")}
        />
      </div>
      {#if !readOnly}
        <div class="sd-bar">
          <button type="button" class="btn btn-primary" onclick={openExceptions}>
            Ausnahme hinzufügen
          </button>
        </div>
      {/if}
      {#if shownShutdown.exceptions.length === 0}
        <EmptyState
          icon="users"
          title="Noch keine Ausnahmen"
          description="Alle Mitarbeitenden sind vom Betriebsurlaub betroffen."
        />
      {:else}
        <DataTable
          listId="verwalten.betriebsurlaub.ausnahmen"
          columns={exceptionColumns}
          rows={shownShutdown.exceptions}
          rowKey={(row) => row.id}
          caption="Ausnahmen vom Betriebsurlaub mit Mitarbeitenden und Grund"
        >
          {#snippet cell(row, column)}
            {#if column.key === "number"}
              {row.employee.employeeNumber}
            {:else if column.key === "reason"}
              {row.reason ?? "–"}
            {:else if column.key === "actions"}
              {#if !readOnly}
                <button
                  type="button"
                  class="btn btn-secondary btn-sm btn-danger"
                  onclick={() => askRemoveException(row)}
                >
                  Entfernen
                </button>
              {/if}
            {:else}
              {row.employee.firstName}
              {row.employee.lastName}
            {/if}
          {/snippet}
        </DataTable>
      {/if}
    </section>

    <!-- ── Löschen ───────────────────────────────────────────────────────────── -->
    {#if !readOnly}
      <section class="settings-group" aria-labelledby="shutdown-delete-title">
        <h2 class="settings-group-title" id="shutdown-delete-title">Betriebsurlaub löschen</h2>
        <p class="settings-group-desc">
          Gebuchte Urlaubstage in offenen Monaten werden storniert und der Urlaub wird
          zurückgebucht, abgeschlossene Monate bleiben unverändert. Der Betriebsurlaub verschwindet
          aus der Liste, seine Ausnahmen gehen mit.
        </p>
        <div>
          <button
            type="button"
            class="btn btn-secondary btn-danger"
            onclick={() => (deleteConfirmOpen = true)}
          >
            Betriebsurlaub löschen
          </button>
        </div>
      </section>
    {/if}
  </div>

  <ConfirmDialog
    bind:open={deleteConfirmOpen}
    title="Betriebsurlaub löschen?"
    description={`„${shownShutdown.name}“ wird gelöscht. Gebuchte Urlaubstage in offenen Monaten werden storniert und der Urlaub wird zurückgebucht, abgeschlossene Monate bleiben unverändert. Diese Aktion kann nicht rückgängig gemacht werden.`}
    confirmLabel="Löschen"
    danger
    onConfirm={confirmDelete}
  />

  <ConfirmDialog
    bind:open={removeConfirm.open}
    title="Ausnahme entfernen?"
    description={`${removeConfirm.name} ist danach wieder vom Betriebsurlaub betroffen. In offenen Monaten wird der Urlaub wieder gebucht, soweit Resturlaub da ist; die übrigen Tage sind bezahlte Freistellung.`}
    confirmLabel="Entfernen"
    danger
    onConfirm={confirmRemoveException}
  />

  <!-- ── Dialog: Ausnahme hinzufügen ───────────────────────────────────────── -->
  <Dialog bind:open={exceptionDialogOpen} title="Ausnahme hinzufügen">
    <form
      id="shutdown-exception-form"
      novalidate
      class="sd-form"
      onsubmit={(event) => {
        event.preventDefault();
        void addException();
      }}
    >
      <FormField
        label="Mitarbeitende"
        required
        hint="Wer hier ausgenommen wird, arbeitet normal und behält die Sollzeit; es wird kein Urlaub gebucht."
      >
        {#snippet field({ id, describedBy })}
          <select
            {id}
            class="form-input"
            bind:value={addExceptionEmpId}
            data-testid="shutdown-exception-employee"
            aria-describedby={describedBy}
          >
            <option value="">– Person wählen –</option>
            {#each availableEmployees as emp (emp.id)}
              <option value={emp.id}>{emp.firstName} {emp.lastName} ({emp.employeeNumber})</option>
            {/each}
          </select>
        {/snippet}
      </FormField>
      <FormField label="Grund">
        {#snippet field({ id, describedBy })}
          <input
            {id}
            class="form-input"
            type="text"
            placeholder="z. B. Notdienstbereitschaft (optional)"
            bind:value={addExceptionReason}
            data-testid="shutdown-exception-reason"
            aria-describedby={describedBy}
          />
        {/snippet}
      </FormField>
      <Note tone="info">
        Schon gebuchte Tage der Person in offenen Monaten werden storniert und der Urlaub wird
        zurückgebucht. Abgeschlossene Monate bleiben unverändert.
      </Note>
    </form>
    {#snippet footer()}
      <button type="button" class="btn btn-secondary" onclick={() => (exceptionDialogOpen = false)}>
        Abbrechen
      </button>
      <button
        type="submit"
        form="shutdown-exception-form"
        class="btn btn-primary"
        disabled={!addExceptionEmpId || savingException}
      >
        {savingException ? "Hinzufügen …" : "Hinzufügen"}
      </button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .sd-stack {
    display: flex;
    flex-direction: column;
    gap: var(--s-8);
  }

  .sd-dates {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: var(--s-4);
  }

  .sd-scope {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    margin: 0;
    padding: 0;
    border: 0;
  }

  .sd-scope-legend {
    padding: 0;
    margin-bottom: var(--s-1);
    font-weight: 600;
  }

  .sd-scope-hint {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }

  .sd-scope-option {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }

  .sd-scope-salons {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding-left: var(--s-6);
  }

  .sd-bar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--s-3);
  }

  .sd-form {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
</style>
