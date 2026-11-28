<script lang="ts">
  // Phase 46 — date-specific availability list (DataTable block: table, cards on a phone), inline edit,
  // and destructive delete. Used by both /availability (MA-Self-Service) and
  // /admin/availability (Admin) pages.

  import { dayLabel } from "$lib/utils/day-label";
  import { tenantFeatures } from "$stores/tenant-features";
  import { tenantDay } from "$lib/utils/tenant-day";
  import Modal from "$components/ui/Modal.svelte";
  import DataTable, { type DataTableColumn } from "$components/ui/DataTable.svelte";
  import AvailabilityStatusPill from "./AvailabilityStatusPill.svelte";
  import AvailabilityEditModal, {
    type AvailabilityEntryDraft,
  } from "./AvailabilityEditModal.svelte";

  type Status = "AVAILABLE" | "UNAVAILABLE" | "PREFERRED";

  export interface OneOffEntry {
    id?: string;
    date: string;
    status: Status;
    note?: string | null;
    validFrom: string;
    validUntil?: string | null;
  }

  interface Props {
    entries: OneOffEntry[];
    disabled?: boolean;
  }

  let { entries = $bindable([]), disabled = false }: Props = $props();

  // The tenant's calendar day (Issue #1072), the day the server files a stamp under.
  function todayISO(): string {
    return tenantDay(new Date(), $tenantFeatures.timezone);
  }

  function formatDE(iso: string): string {
    // Local-only ISO date (YYYY-MM-DD) → DD.MM.YYYY without dragging in date-fns.
    if (!iso || iso.length < 10) return iso;
    return dayLabel(iso, { year: true });
  }

  // ── Sorted view ─────────────────────────────────────────────────────
  const sorted = $derived([...entries].sort((a, b) => a.date.localeCompare(b.date)));

  // The table block pages itself (listId in the register); the columns are the one-off's facts.
  const ONEOFF_COLUMNS: DataTableColumn[] = [
    { key: "date", label: "Datum", primary: true },
    { key: "status", label: "Status" },
    { key: "validUntil", label: "Gültig bis" },
    { key: "note", label: "Notiz" },
    { key: "actions", label: "Aktion", align: "end" },
  ];

  // ── Edit modal state ────────────────────────────────────────────────
  let editOpen = $state(false);
  let editTargetIdx = $state<number | null>(null);
  let editInitial = $state<AvailabilityEntryDraft | undefined>(undefined);

  function openAdd() {
    if (disabled) return;
    editTargetIdx = null;
    editInitial = {
      dayOfWeek: null,
      date: todayISO(),
      status: "AVAILABLE",
      note: null,
      validFrom: todayISO(),
      validUntil: null,
    };
    editOpen = true;
  }

  function openEdit(entry: OneOffEntry) {
    if (disabled) return;
    const idx = entries.findIndex(
      (e) => e === entry || (e.id && e.id === entry.id) || e.date === entry.date,
    );
    editTargetIdx = idx >= 0 ? idx : null;
    editInitial = {
      dayOfWeek: null,
      date: entry.date,
      status: entry.status,
      note: entry.note ?? null,
      validFrom: entry.validFrom,
      validUntil: entry.validUntil ?? null,
    };
    editOpen = true;
  }

  function handleEditSave(draft: AvailabilityEntryDraft) {
    if (!draft.date) return;
    const next: OneOffEntry = {
      id: editTargetIdx != null ? entries[editTargetIdx]?.id : undefined,
      date: draft.date,
      status: draft.status,
      note: draft.note ?? null,
      validFrom: draft.validFrom,
      validUntil: draft.validUntil ?? null,
    };
    if (editTargetIdx != null) {
      entries = entries.map((e, i) => (i === editTargetIdx ? next : e));
    } else {
      entries = [...entries, next];
    }
    editOpen = false;
    editTargetIdx = null;
  }

  function handleEditCancel() {
    editOpen = false;
    editTargetIdx = null;
  }

  // ── Destructive confirm ─────────────────────────────────────────────
  let confirmOpen = $state(false);
  let confirmTarget = $state<OneOffEntry | null>(null);

  function askRemove(entry: OneOffEntry) {
    if (disabled) return;
    confirmTarget = entry;
    confirmOpen = true;
  }

  function doRemove() {
    if (!confirmTarget) return;
    const target = confirmTarget;
    entries = entries.filter(
      (e) => !(e === target || (e.id && e.id === target.id) || e.date === target.date),
    );
    confirmOpen = false;
    confirmTarget = null;
  }

  function cancelRemove() {
    confirmOpen = false;
    confirmTarget = null;
  }
</script>

<div class="av-oneoff-head">
  <button type="button" class="btn btn-secondary btn-sm" {disabled} onclick={openAdd}>
    + Einmaltermin hinzufügen
  </button>
</div>

{#if sorted.length === 0}
  <p class="av-empty">Keine Einmaltermine vorhanden.</p>
{:else}
  <DataTable
    caption="Einzelne Tage"
    columns={ONEOFF_COLUMNS}
    rows={sorted}
    rowKey={(entry) => entry.id ?? entry.date}
    listId="ich.verfuegbarkeit.einzeltage"
  >
    {#snippet cell(entry, column)}
      {#if column.key === "date"}
        <span class="av-mono">{formatDE(entry.date)}</span>
      {:else if column.key === "status"}
        <AvailabilityStatusPill status={entry.status} />
      {:else if column.key === "validUntil"}
        <span class="av-mono">{entry.validUntil ? formatDE(entry.validUntil) : "—"}</span>
      {:else if column.key === "note"}
        {entry.note ?? ""}
      {:else if column.key === "actions"}
        <div class="av-col-action__group">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            {disabled}
            onclick={() => openEdit(entry)}
          >
            Bearbeiten
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            {disabled}
            onclick={() => askRemove(entry)}
          >
            Entfernen
          </button>
        </div>
      {/if}
    {/snippet}
  </DataTable>
{/if}

<AvailabilityEditModal
  bind:open={editOpen}
  mode="oneoff"
  isNew={editTargetIdx == null}
  initial={editInitial}
  onsave={handleEditSave}
  oncancel={handleEditCancel}
/>

{#if confirmOpen}
  <div role="alertdialog" aria-modal="true" aria-label="Eintrag entfernen?">
    <Modal bind:open={confirmOpen} title="Eintrag entfernen?">
      <p>
        Dieser Verfügbarkeits-Eintrag wird dauerhaft gelöscht. Vorhandene Schichten bleiben
        unverändert.
      </p>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" onclick={cancelRemove}>Abbrechen</button>
        <button type="button" class="btn btn-danger" onclick={doRemove}>Entfernen</button>
      </div>
    </Modal>
  </div>
{/if}

<style>
  .av-oneoff-head {
    margin-bottom: var(--s-3);
  }

  .av-empty {
    color: var(--text-2);
    font-size: 0.9375rem;
    margin: 0;
  }

  .av-mono {
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }

  /* Issue #442 — flex layout lives on the inner wrapper, never on the td itself (the td is the
     DataTable block's), and wraps so both actions stay reachable on a phone card. */
  .av-col-action__group {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
    justify-content: flex-end;
    align-items: center;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--s-2);
    margin-top: var(--s-4);
  }
</style>
