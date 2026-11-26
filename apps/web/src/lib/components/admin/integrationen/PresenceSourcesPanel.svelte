<!--
  PresenceSourcesPanel - the „WLAN-Anwesenheit“ tab of Verwalten › System › Integrationen (Issue #854, rebuilt on
  the blocks of #843; the data, the endpoints and the rules are those of the pre-#854 page /admin/integrations,
  Issues #388 and #610). A management section without configuration keys of its own (registry section
  `integrationen-wlan`). Four groups: the WLAN adapters (the API calls them presence sources), the pairing guide,
  the device list and the list of the people who use WLAN presence.

  Loads the sources and the opt-in list itself, the first time the tab is shown. The device list loads by itself
  too (Issue #994, N-16): after the sources were read, when the adapter choice changes and after the first adapter
  was created - never from an `$effect`; `devicesSourceId` remembers which adapter the list belongs to. Without an
  active adapter the device and QR groups show one sentence and no button. Writes are `POST` and
  `DELETE /admin/presence-sources` (create with the key shown ONCE in OneTimeKey, revoke behind a confirmation)
  and the device assignment (`mapDevice` in a Dialog, `unmapDevice` behind a confirmation); each acts at once and
  answers with a toast. Where the tenant has not booked the add-on module the calm hint replaces the create action
  (Issue #566, display only; the server answers 409 either way) - adapters already there stay listed and
  revocable.

  The pairing guide (Issue #610) is browser state only: this panel adds no request for it.

  Presentation only: `presence-source:manage` is checked by the API; a 403 shows a calm note, not an error.

  Props:
    active - true while the tab is the selected one
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { api, ApiError } from "$api/client";
  import {
    listSources,
    createSource,
    revokeSource,
    listDevices,
    mapDevice,
    unmapDevice,
    listOptedInEmployees,
    type PresenceSource,
    type FritzDevice,
    type OptedInEmployee,
  } from "$lib/api/presence";
  import { toasts } from "$stores/toast";
  import { salonContext, moduleBooked } from "$stores/salon-context";
  import ModuleHint from "$lib/components/admin/ModuleHint.svelte";
  import OneTimeKey from "$lib/components/admin/integrationen/OneTimeKey.svelte";
  import PairingGuide from "$lib/components/admin/PairingGuide.svelte";
  import Chip from "$components/ui/Chip.svelte";
  import ConfirmDialog from "$components/ui/ConfirmDialog.svelte";
  import DataTable, { type DataTableColumn } from "$components/ui/DataTable.svelte";
  import Dialog from "$components/ui/Dialog.svelte";
  import EmptyState from "$components/ui/EmptyState.svelte";
  import ErrorState from "$components/ui/ErrorState.svelte";
  import FormField from "$components/ui/FormField.svelte";
  import Note from "$components/ui/Note.svelte";
  import Skeleton from "$components/ui/Skeleton.svelte";
  import InfoHint, { hintLabel } from "$components/ui/InfoHint.svelte"; // Issue #1058

  interface Props {
    active: boolean;
  }

  let { active }: Props = $props();

  // Phase 566 (D-12): display only. `=== false` only: an unknown state never hides the create action.
  const hardwareBooked = $derived(moduleBooked($salonContext, "HARDWARE_CLOCK"));

  let forbidden = $state(false);

  // ── Group 1: presence sources ─────────────────────────────────────────────
  let sources: PresenceSource[] = $state([]);
  let sourcesLoading = $state(false);
  let sourcesError = $state("");
  // True once the first read of the sources has answered, so the device and QR groups never flash their
  // „no adapter yet“ sentence while the adapters are still loading.
  let sourcesLoaded = $state(false);
  // Shown once after the creation, then forgotten (T-854-34).
  let newRawKey = $state("");

  const sourceColumns: DataTableColumn[] = [
    { key: "name", label: "Name", primary: true },
    { key: "keyPrefix", label: "Schlüssel-Präfix" },
    { key: "lastUsedAt", label: "Zuletzt verwendet" },
    { key: "status", label: "Status" },
    { key: "actions", label: "Aktionen", align: "end" },
  ];

  async function loadSources() {
    sourcesLoading = true;
    sourcesError = "";
    try {
      sources = await listSources();
      if (
        !selectedSourceId ||
        !sources.some((src) => src.id === selectedSourceId && !src.revokedAt)
      ) {
        selectedSourceId = sources.find((src) => !src.revokedAt)?.id ?? "";
      }
      forbidden = false;
      sourcesLoaded = true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        forbidden = true;
      } else {
        sourcesError = "Die WLAN-Adapter konnten nicht geladen werden.";
      }
    } finally {
      sourcesLoading = false;
    }
    if (sourcesLoaded && !sourcesError && !forbidden) await syncDevices();
  }

  // Create dialog
  let createOpen = $state(false);
  let newSourceName = $state("");
  let newSourceAdapterUrl = $state("");
  let sourceCreating = $state(false);
  let sourceCreateError = $state("");

  function openCreateSource() {
    newSourceName = "";
    newSourceAdapterUrl = "";
    sourceCreateError = "";
    createOpen = true;
  }

  // Runs inside the Dialog's form: a refusal keeps the dialog open with its text.
  async function handleCreateSource() {
    if (!newSourceName.trim()) {
      sourceCreateError = "Gib dem Adapter einen Namen.";
      return;
    }
    sourceCreating = true;
    sourceCreateError = "";
    try {
      const res = await createSource(newSourceName.trim(), newSourceAdapterUrl.trim() || undefined);
      newRawKey = res.rawKey;
      createOpen = false;
      await loadSources();
    } catch (err: unknown) {
      // A 409 carries the server's German sentence (module not booked); anything else keeps the
      // generic retry hint.
      sourceCreateError =
        err instanceof ApiError && err.status === 409
          ? err.message
          : "Schlüssel konnte nicht erstellt werden. Bitte versuch es noch einmal.";
    } finally {
      sourceCreating = false;
    }
  }

  let revokeConfirm: { open: boolean; source: PresenceSource | null } = $state({
    open: false,
    source: null,
  });

  function askRevokeSource(source: PresenceSource) {
    revokeConfirm = { open: true, source };
  }

  async function confirmRevokeSource() {
    const source = revokeConfirm.source;
    if (!source) return;
    try {
      await revokeSource(source.id);
    } catch (err) {
      toasts.error(
        err instanceof ApiError ? err.message : "Der Schlüssel konnte nicht widerrufen werden.",
      );
      throw err;
    }
    toasts.success("Schlüssel widerrufen.");
    await loadSources();
  }

  // ── Group 3: device list ──────────────────────────────────────────────────
  type Employee = { id: string; firstName: string; lastName: string };
  let employees: Employee[] = $state([]);
  let selectedSourceId = $state("");
  let devices: FritzDevice[] = $state([]);
  let devicesLoading = $state(false);
  let devicesError = $state("");
  let devicesLastRefreshed = $state<Date | null>(null);
  // The adapter the shown list belongs to (Issue #994, N-16): a load runs only when the chosen adapter differs.
  let devicesSourceId = "";
  let deviceAssigning = $state<Record<string, boolean>>({}); // mac -> saving
  let devPage = $state(1);
  const activeSources = $derived(sources.filter((src) => !src.revokedAt));

  const deviceColumns: DataTableColumn[] = [
    { key: "mac", label: "WLAN-Adresse", primary: true },
    { key: "hostname", label: "Gerätename" },
    { key: "lastSeen", label: "Zuletzt gesehen" },
    { key: "status", label: "Status" },
    { key: "employee", label: "Person" },
    { key: "actions", label: "Aktionen", align: "end" },
  ];

  // An answer of an adapter that is no longer the chosen one is dropped, so a quick switch cannot show the
  // devices of the wrong adapter.
  async function refreshDevices(sourceId: string = selectedSourceId) {
    if (!sourceId) return;
    if (devicesSourceId !== sourceId) {
      devices = [];
      devicesLastRefreshed = null;
    }
    devicesSourceId = sourceId;
    devicesLoading = true;
    devicesError = "";
    try {
      const list = await listDevices(sourceId);
      if (devicesSourceId !== sourceId) return;
      devices = list;
      devicesLastRefreshed = new Date();
      devPage = 1;
    } catch {
      if (devicesSourceId !== sourceId) return;
      devicesError =
        "Geräteliste konnte nicht geladen werden. Bitte prüf, ob der Adapter erreichbar ist.";
    } finally {
      if (devicesSourceId === sourceId) devicesLoading = false;
    }
  }

  // Called after every read of the sources: loads the list of the chosen adapter once, forgets it when no
  // active adapter is left.
  async function syncDevices() {
    if (!selectedSourceId) {
      devices = [];
      devicesSourceId = "";
      devicesLastRefreshed = null;
      devicesError = "";
      devicesLoading = false;
      return;
    }
    if (selectedSourceId !== devicesSourceId) await refreshDevices(selectedSourceId);
  }

  const refreshedAt = $derived(
    devicesLastRefreshed
      ? devicesLastRefreshed.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
      : "",
  );

  function fullName(person: { firstName: string; lastName: string }): string {
    return `${person.firstName} ${person.lastName}`;
  }

  function formatLastSeen(iso: string | null): string {
    if (!iso) return "–";
    return new Date(iso).toLocaleString("de-DE");
  }

  // Assign dialog
  let assignOpen = $state(false);
  let assignDevice: FritzDevice | null = $state(null);
  let assignEmployeeId = $state("");

  function openAssign(device: FritzDevice) {
    assignDevice = device;
    assignEmployeeId = device.assignedEmployeeId ?? "";
    assignOpen = true;
  }

  async function saveAssignment() {
    if (!assignDevice || !assignEmployeeId || !selectedSourceId) return;
    const mac = assignDevice.mac;
    const employeeId = assignEmployeeId;
    deviceAssigning = { ...deviceAssigning, [mac]: true };
    try {
      const result = await mapDevice(selectedSourceId, mac, employeeId);
      const matched = employees.find((e) => e.id === employeeId);
      const name = matched ? `${matched.firstName} ${matched.lastName}` : employeeId;
      devices = devices.map((d) =>
        d.mac === mac ? { ...d, assignedEmployeeId: employeeId, assignedEmployeeName: name } : d,
      );
      if (result.optInAutoEnabled) {
        toasts.success(`${name} zugewiesen. WLAN-Anwesenheit ist automatisch eingeschaltet.`);
        // The opt-in overview reflects the new opt-in.
        void loadOptedIn();
      } else {
        toasts.success(`${name} zugewiesen.`);
      }
      assignOpen = false;
    } catch {
      toasts.error("Zuweisung fehlgeschlagen.");
    } finally {
      deviceAssigning = { ...deviceAssigning, [mac]: false };
    }
  }

  let unassignConfirm: { open: boolean; mac: string | null; name: string } = $state({
    open: false,
    mac: null,
    name: "",
  });

  function askUnassign(device: FritzDevice) {
    unassignConfirm = {
      open: true,
      mac: device.mac,
      name: device.assignedEmployeeName ?? "Person",
    };
  }

  async function confirmUnassign() {
    const mac = unassignConfirm.mac;
    if (!selectedSourceId || !mac) return;
    const name = unassignConfirm.name;
    deviceAssigning = { ...deviceAssigning, [mac]: true };
    try {
      const result = await unmapDevice(selectedSourceId, mac);
      devices = devices.map((d) =>
        d.mac === mac ? { ...d, assignedEmployeeId: null, assignedEmployeeName: null } : d,
      );
      if (result.optInAutoDisabled) {
        toasts.success(`Zuweisung aufgehoben. WLAN-Anwesenheit für ${name} ist ausgeschaltet.`);
        void loadOptedIn();
      } else {
        toasts.success("Zuweisung aufgehoben.");
      }
    } catch (err) {
      toasts.error("Zuweisung konnte nicht aufgehoben werden.");
      throw err;
    } finally {
      deviceAssigning = { ...deviceAssigning, [mac]: false };
    }
  }

  // ── Group 4: opt-in overview ──────────────────────────────────────────────
  let optedIn: OptedInEmployee[] = $state([]);
  let optInLoading = $state(false);
  let optInError = $state("");

  const optInColumns: DataTableColumn[] = [
    { key: "name", label: "Person", primary: true },
    { key: "optIn", label: "Status" },
    { key: "macs", label: "WLAN-Adressen" },
    { key: "since", label: "Seit" },
  ];

  async function loadOptedIn() {
    optInLoading = true;
    optInError = "";
    try {
      optedIn = await listOptedInEmployees();
    } catch (err) {
      // A 403 is already shown by the sources group; anything else gets its own retry.
      if (!(err instanceof ApiError && err.status === 403)) {
        optInError = "Die Liste der Personen mit WLAN-Anwesenheit konnte nicht geladen werden.";
      }
    } finally {
      optInLoading = false;
    }
  }

  // Lazy load on the first visit of the tab: a person who never opens it costs no request.
  let started = false;
  $effect(() => {
    if (!active || started) return;
    started = true;
    untrack(() => void start());
  });

  // GET /employees returns the array directly (not wrapped in { employees }); it feeds the assignment
  // dropdown only, so a refusal is not an error of the page.
  async function loadEmployees() {
    try {
      const res = await api.get<Employee[] | { employees: Employee[] }>("/employees");
      employees = Array.isArray(res) ? res : (res.employees ?? []);
    } catch {
      /* non-fatal - the dropdown stays empty */
    }
  }

  async function start() {
    // loadSources() also loads the device list of the first active adapter (syncDevices); the people for the
    // assignment dropdown load beside it so the list does not wait for them.
    await Promise.all([loadSources(), loadOptedIn(), loadEmployees()]);
  }
</script>

<!-- ── Group 1: WLAN-Adapter ─────────────────────────────────────────────── -->
<section class="settings-group" aria-labelledby="integrationen-quellen-title">
  <div class="hint-row">
    <h2 class="settings-group-title" id="integrationen-quellen-title">WLAN-Adapter</h2>
    <InfoHint
      text="Jeder WLAN-Adapter meldet sich mit einem eigenen Schlüssel an. Die Schlüssel verwaltest du hier."
      label={hintLabel("WLAN-Adapter")}
    />
  </div>

  {#if newRawKey}
    <OneTimeKey
      title="Neuer Schlüssel erstellt"
      rawKey={newRawKey}
      onclose={() => (newRawKey = "")}
    />
  {/if}

  {#if hardwareBooked === false}
    <ModuleHint module="HARDWARE_CLOCK" subject="WLAN-Adapter" />
  {:else}
    <div class="ip-actions">
      <button type="button" class="btn btn-primary" onclick={openCreateSource}
        >Adapter anlegen</button
      >
    </div>
  {/if}

  {#if forbidden}
    <div role="alert">
      <Note tone="bad">Für die WLAN-Anwesenheit fehlt dir die Berechtigung.</Note>
    </div>
  {:else if sourcesError}
    <ErrorState message={sourcesError} onRetry={loadSources} retrying={sourcesLoading} />
  {:else if sourcesLoading && sources.length === 0}
    <Skeleton shape="card" count={1} lines={3} />
  {:else if sources.length === 0}
    <!-- Without the module only its hint stands above: no invitation to set up the first one (#566). -->
    {#if hardwareBooked !== false}
      <EmptyState
        icon="wifi"
        title="Noch kein WLAN-Adapter"
        description="Leg einen Schlüssel für deinen ersten Adapter an."
      />
    {/if}
  {:else}
    <DataTable
      listId="verwalten.integrationen.praesenz-quellen"
      columns={sourceColumns}
      rows={sources}
      rowKey={(row) => row.id}
      caption="WLAN-Adapter mit Schlüssel und Status"
    >
      {#snippet cell(row, column)}
        {#if column.key === "keyPrefix"}
          <code class="ip-code">{row.keyPrefix}</code>
        {:else if column.key === "lastUsedAt"}
          {row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString("de-DE") : "Nie"}
        {:else if column.key === "status"}
          {#if row.revokedAt}
            <Chip tone="bad">Widerrufen</Chip>
          {:else}
            <Chip tone="ok">Aktiv</Chip>
          {/if}
        {:else if column.key === "actions"}
          {#if !row.revokedAt}
            <button
              type="button"
              class="btn btn-secondary btn-sm btn-danger"
              onclick={() => askRevokeSource(row)}
            >
              Schlüssel widerrufen
            </button>
          {/if}
        {:else}
          {row.name}
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</section>

<!-- ── Group 2: Handys per QR-Code koppeln (Issue #610) ──────────────────── -->
<section class="settings-group" aria-labelledby="integrationen-koppeln-title">
  <div class="hint-row">
    <h2 class="settings-group-title" id="integrationen-koppeln-title">
      Handys per QR-Code koppeln
    </h2>
    <InfoHint
      text="QR-Code für das Salon-WLAN erstellen und aushängen."
      label={hintLabel("Handys per QR-Code koppeln")}
    />
  </div>
  {#if !sourcesLoaded}
    {#if !forbidden && !sourcesError}
      <Skeleton shape="card" count={1} lines={3} />
    {/if}
  {:else if activeSources.length > 0}
    <PairingGuide />
  {:else}
    <p class="ip-muted">Den QR-Code erstellst du, sobald ein WLAN-Adapter angemeldet ist.</p>
  {/if}
</section>

<!-- ── Group 3: WLAN-Geräteliste ─────────────────────────────────────────── -->
<section class="settings-group" aria-labelledby="integrationen-geraete-title">
  <div class="hint-row">
    <h2 class="settings-group-title" id="integrationen-geraete-title">WLAN-Geräteliste</h2>
    <InfoHint
      text="Verbundene Geräte und ihre Zuweisungen."
      label={hintLabel("WLAN-Geräteliste")}
    />
  </div>

  {#if !sourcesLoaded}
    {#if !forbidden && !sourcesError}
      <Skeleton shape="card" count={1} lines={3} />
    {/if}
  {:else if activeSources.length === 0}
    <p class="ip-muted">
      Sobald ein WLAN-Adapter angemeldet ist, erscheinen hier die Geräte in seinem WLAN.
    </p>
  {:else}
    <div class="ip-device-head">
      {#if activeSources.length > 1}
        <FormField label="Adapter">
          {#snippet field({ id, describedBy })}
            <select
              {id}
              class="form-input ip-source"
              aria-describedby={describedBy}
              bind:value={selectedSourceId}
              onchange={(event) => void refreshDevices(event.currentTarget.value)}
            >
              {#each activeSources as src (src.id)}
                <option value={src.id}>{src.name}</option>
              {/each}
            </select>
          {/snippet}
        </FormField>
      {/if}
      {#if devicesLastRefreshed}
        <span class="ip-refreshed">Stand {refreshedAt}</span>
      {/if}
      <button
        type="button"
        class="btn btn-secondary"
        onclick={() => void refreshDevices()}
        disabled={devicesLoading}
      >
        {devicesLoading ? "Aktualisieren …" : "Aktualisieren"}
      </button>
    </div>

    {#if devicesError}
      <ErrorState
        message={devicesError}
        onRetry={() => void refreshDevices()}
        retrying={devicesLoading}
      />
    {:else if devicesLoading && devices.length === 0}
      <Skeleton shape="card" count={1} lines={3} />
    {:else if devices.length > 0}
      <DataTable
        listId="verwalten.integrationen.wlan-geraete"
        columns={deviceColumns}
        rows={devices}
        bind:page={devPage}
        rowKey={(row) => row.mac}
        caption="WLAN-Geräte mit Status und zugewiesener Person"
      >
        {#snippet cell(row, column)}
          {#if column.key === "mac"}
            <code class="ip-code">{row.mac}</code>
          {:else if column.key === "hostname"}
            {row.hostname || "–"}
          {:else if column.key === "lastSeen"}
            {formatLastSeen(row.lastSeen)}
          {:else if column.key === "status"}
            {#if row.online}
              <Chip tone="ok">Online</Chip>
            {:else}
              <Chip tone="neutral">Offline</Chip>
            {/if}
          {:else if column.key === "employee"}
            {#if row.assignedEmployeeId}
              {row.assignedEmployeeName ?? row.assignedEmployeeId}
            {:else}
              <span class="ip-muted">Nicht zugewiesen</span>
            {/if}
          {:else if row.assignedEmployeeId}
            <button
              type="button"
              class="btn btn-secondary btn-sm btn-danger"
              onclick={() => askUnassign(row)}
              disabled={deviceAssigning[row.mac]}
            >
              Aufheben
            </button>
          {:else}
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              onclick={() => openAssign(row)}
              disabled={deviceAssigning[row.mac]}
            >
              Zuweisen
            </button>
          {/if}
        {/snippet}
      </DataTable>
    {:else if devicesLastRefreshed}
      <EmptyState
        icon="wifi"
        title="Keine Geräte gefunden"
        description="Stell sicher, dass der WLAN-Adapter (z. B. FRITZ!Box) läuft und verbunden ist."
      />
    {/if}
  {/if}
</section>

<!-- ── Group 4: who uses WLAN presence ───────────────────────────────────── -->
<section class="settings-group" aria-labelledby="integrationen-optin-title">
  <div class="hint-row">
    <h2 class="settings-group-title" id="integrationen-optin-title">Wer WLAN-Anwesenheit nutzt</h2>
    <InfoHint
      text="Wer die WLAN-Anwesenheit im eigenen Profil eingeschaltet hat."
      label={hintLabel("Wer WLAN-Anwesenheit nutzt")}
    />
  </div>

  {#if optInError}
    <ErrorState message={optInError} onRetry={loadOptedIn} retrying={optInLoading} />
  {:else if optInLoading && optedIn.length === 0}
    <Skeleton shape="card" count={1} lines={3} />
  {:else if optedIn.length === 0}
    <EmptyState
      icon="inbox"
      title="Noch keine Person"
      description="Noch niemand hat die WLAN-Anwesenheit eingeschaltet."
    />
  {:else}
    <DataTable
      listId="verwalten.integrationen.wlan-personen"
      columns={optInColumns}
      rows={optedIn}
      rowKey={(row) => row.id}
      caption="Personen mit WLAN-Anwesenheit"
    >
      {#snippet cell(row, column)}
        {#if column.key === "optIn"}
          {#if row.wifiPresenceEnabled}
            <Chip tone="ok">Aktiv</Chip>
          {:else}
            <Chip tone="neutral">Inaktiv</Chip>
          {/if}
        {:else if column.key === "macs"}
          {#if row.wifiMacs.length === 0}
            –
          {:else if row.wifiMacs.length <= 2}
            {#each row.wifiMacs as mac (mac)}
              <code class="ip-code ip-mac">{mac}</code>
            {/each}
          {:else}
            <Chip tone="info">{row.wifiMacs.length} Geräte</Chip>
          {/if}
        {:else if column.key === "since"}
          {row.wifiOptInAt ? new Date(row.wifiOptInAt).toLocaleDateString("de-DE") : "–"}
        {:else}
          {fullName(row)}
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</section>

<!-- ── Dialog: create a WLAN adapter ──────────────────────────────────────── -->
<Dialog bind:open={createOpen} title="Adapter anlegen">
  <form
    id="presence-source-form"
    novalidate
    class="ip-form"
    onsubmit={(event) => {
      event.preventDefault();
      void handleCreateSource();
    }}
  >
    <FormField label="Name" required hint="Zum Beispiel „FritzBox Büro“.">
      {#snippet field({ id, describedBy })}
        <input
          {id}
          class="form-input"
          type="text"
          aria-describedby={describedBy}
          bind:value={newSourceName}
        />
      {/snippet}
    </FormField>
    <FormField label="Adapter-Adresse (optional)">
      {#snippet field({ id, describedBy })}
        <input
          {id}
          class="form-input"
          type="url"
          aria-describedby={describedBy}
          bind:value={newSourceAdapterUrl}
        />
      {/snippet}
    </FormField>
    {#if sourceCreateError}
      <div role="alert"><Note tone="bad">{sourceCreateError}</Note></div>
    {/if}
  </form>
  {#snippet footer()}
    <button type="button" class="btn btn-secondary" onclick={() => (createOpen = false)}>
      Abbrechen
    </button>
    <button
      type="submit"
      form="presence-source-form"
      class="btn btn-primary"
      disabled={sourceCreating}
    >
      {sourceCreating ? "Anlegen …" : "Schlüssel erstellen"}
    </button>
  {/snippet}
</Dialog>

<!-- ── Dialog: assign a device to a person ────────────────────────────────── -->
{#if assignDevice}
  <Dialog
    bind:open={assignOpen}
    eyebrow="Gerät zuweisen"
    title={assignDevice.hostname || assignDevice.mac}
  >
    <dl class="ip-meta">
      <div>
        <dt>WLAN-Adresse</dt>
        <dd><code class="ip-code">{assignDevice.mac}</code></dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>{assignDevice.online ? "Online" : "Offline"}</dd>
      </div>
      <div>
        <dt>Zuletzt gesehen</dt>
        <dd>{formatLastSeen(assignDevice.lastSeen)}</dd>
      </div>
    </dl>
    <FormField
      label="Person"
      hint="Bei der ersten Zuweisung schaltet Clokr die WLAN-Anwesenheit für die Person ein."
    >
      {#snippet field({ id, describedBy })}
        <select
          {id}
          class="form-input"
          aria-describedby={describedBy}
          bind:value={assignEmployeeId}
        >
          <option value="">Person auswählen …</option>
          {#each employees as emp (emp.id)}
            <option value={emp.id}>{emp.firstName} {emp.lastName}</option>
          {/each}
        </select>
      {/snippet}
    </FormField>
    {#snippet footer()}
      <button
        type="button"
        class="btn btn-secondary"
        onclick={() => (assignOpen = false)}
        disabled={deviceAssigning[assignDevice!.mac]}>Abbrechen</button
      >
      <button
        type="button"
        class="btn btn-primary"
        onclick={saveAssignment}
        disabled={!assignEmployeeId || deviceAssigning[assignDevice!.mac]}
      >
        {deviceAssigning[assignDevice!.mac] ? "Speichern …" : "Zuweisung speichern"}
      </button>
    {/snippet}
  </Dialog>
{/if}

<!-- ── Confirmations ──────────────────────────────────────────────────────── -->
<ConfirmDialog
  bind:open={revokeConfirm.open}
  title="Schlüssel des Adapters widerrufen?"
  description="Der Adapter kann sich dann nicht mehr anmelden."
  confirmLabel="Widerrufen"
  danger
  onConfirm={confirmRevokeSource}
/>

<ConfirmDialog
  bind:open={unassignConfirm.open}
  title="Zuweisung aufheben?"
  description={`Die WLAN-Adresse wird von ${unassignConfirm.name} getrennt.`}
  confirmLabel="Aufheben"
  danger
  onConfirm={confirmUnassign}
/>

<style>
  .ip-actions {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--s-3);
  }

  .ip-form {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }

  .ip-device-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--s-3);
    margin-bottom: var(--s-3);
  }

  .ip-source {
    width: auto;
    min-width: 12rem;
  }

  .ip-refreshed,
  .ip-muted {
    font-size: var(--fs-sm);
    color: var(--text-2);
  }

  .ip-muted {
    margin: 0;
  }

  .ip-code {
    font-family: var(--font-code);
    font-size: var(--fs-sm);
  }

  .ip-mac {
    margin-right: var(--s-1);
  }

  .ip-meta {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    margin: 0 0 var(--s-4);
    padding: var(--s-3);
    border-radius: var(--r-control);
    background: var(--sunk);
    font-size: var(--fs-sm);
  }

  .ip-meta div {
    display: flex;
    justify-content: space-between;
    gap: var(--s-3);
  }

  .ip-meta dt {
    color: var(--text-2);
    font-weight: 500;
  }

  .ip-meta dd {
    margin: 0;
    color: var(--text);
  }
</style>
