<script lang="ts">
  // Phase 46 — 7-row recurring weekly availability grid.
  // One row per dayOfWeek (Mo, Di, Mi, Do, Fr, Sa, So). Each row contains a
  // radiogroup of three AvailabilityStatusPill buttons (AVAILABLE / UNAVAILABLE /
  // PREFERRED) plus actions to edit details or delete the entry.
  //
  // Per CLAUDE.md UI Consistency Rules: per-page scoped overrides of the global
  // calendar recipe are forbidden — this component uses a local av-recurring-row
  // class instead. See app.css for the canonical calendar styles.
  //
  // Issue #991 (N-27, M-27): light rows (one container border with dividers), the status edge comes
  // from `data-status` (no inline colour), the trash is an Icon shown only on an existing entry and
  // removing asks through ConfirmDialog, and a phone row is two short lines.

  import { tenantFeatures } from "$stores/tenant-features";
  import { tenantDay } from "$lib/utils/tenant-day";
  import ConfirmDialog from "$components/ui/ConfirmDialog.svelte";
  import Icon from "$components/Icon.svelte";
  import SegmentedControl from "$lib/components/ui/SegmentedControl.svelte";
  import AvailabilityEditModal, {
    type AvailabilityEntryDraft,
  } from "./AvailabilityEditModal.svelte";

  type Status = "AVAILABLE" | "UNAVAILABLE" | "PREFERRED";

  export interface RecurringEntry {
    id?: string;
    dayOfWeek: number;
    status: Status;
    note?: string | null;
    validFrom?: string;
    validUntil?: string | null;
  }

  interface Props {
    entries: RecurringEntry[];
    disabled?: boolean;
  }

  let { entries = $bindable([]), disabled = false }: Props = $props();

  // Display order: Monday-first (1..6, 0 for Sunday last) to match German week.
  const WEEK = [
    { dow: 1, short: "Mo", long: "Montag" },
    { dow: 2, short: "Di", long: "Dienstag" },
    { dow: 3, short: "Mi", long: "Mittwoch" },
    { dow: 4, short: "Do", long: "Donnerstag" },
    { dow: 5, short: "Fr", long: "Freitag" },
    { dow: 6, short: "Sa", long: "Samstag" },
    { dow: 0, short: "So", long: "Sonntag" },
  ];

  // The tenant's calendar day (Issue #1072), the day the server files a stamp under.
  function todayISO(): string {
    return tenantDay(new Date(), $tenantFeatures.timezone);
  }

  function entryFor(dow: number): RecurringEntry | undefined {
    return entries.find((e) => e.dayOfWeek === dow);
  }

  function setStatus(dow: number, status: Status) {
    if (disabled) return;
    const idx = entries.findIndex((e) => e.dayOfWeek === dow);
    if (idx >= 0) {
      entries = entries.map((e, i) => (i === idx ? { ...e, status } : e));
    } else {
      entries = [
        ...entries,
        { dayOfWeek: dow, status, note: null, validFrom: todayISO(), validUntil: null },
      ];
    }
  }

  // ── Edit modal state ────────────────────────────────────────────────
  let editOpen = $state(false);
  let editTargetDow = $state<number | null>(null);
  let editInitial = $state<AvailabilityEntryDraft | undefined>(undefined);

  function openEdit(dow: number) {
    if (disabled) return;
    const existing = entryFor(dow);
    editTargetDow = dow;
    editInitial = {
      dayOfWeek: dow,
      date: null,
      status: existing?.status ?? "AVAILABLE",
      note: existing?.note ?? null,
      validFrom: existing?.validFrom ?? todayISO(),
      validUntil: existing?.validUntil ?? null,
    };
    editOpen = true;
  }

  function handleEditSave(draft: AvailabilityEntryDraft) {
    if (editTargetDow == null) return;
    const dow = editTargetDow;
    const idx = entries.findIndex((e) => e.dayOfWeek === dow);
    const next: RecurringEntry = {
      id: entries[idx]?.id,
      dayOfWeek: dow,
      status: draft.status,
      note: draft.note ?? null,
      validFrom: draft.validFrom,
      validUntil: draft.validUntil ?? null,
    };
    if (idx >= 0) {
      entries = entries.map((e, i) => (i === idx ? next : e));
    } else {
      entries = [...entries, next];
    }
    editOpen = false;
    editTargetDow = null;
  }

  function handleEditCancel() {
    editOpen = false;
    editTargetDow = null;
  }

  // ── Destructive confirm ─────────────────────────────────────────────
  let confirmOpen = $state(false);
  let confirmTargetDow = $state<number | null>(null);

  function askRemove(dow: number) {
    if (disabled) return;
    confirmTargetDow = dow;
    confirmOpen = true;
  }

  function doRemove() {
    if (confirmTargetDow == null) return;
    entries = entries.filter((e) => e.dayOfWeek !== confirmTargetDow);
    confirmOpen = false;
    confirmTargetDow = null;
  }

  function cancelRemove() {
    confirmOpen = false;
    confirmTargetDow = null;
  }

  const STATUS_OPTIONS = [
    { value: "AVAILABLE", label: "Verfügbar" },
    { value: "UNAVAILABLE", label: "Nicht verfügbar" },
    { value: "PREFERRED", label: "Bevorzugt" },
  ];
</script>

{#if entries.length === 0}
  <p class="av-empty">Noch keine wöchentliche Verfügbarkeit hinterlegt.</p>
{/if}

<div class="av-recurring-rows">
  {#each WEEK as day (day.dow)}
    {@const entry = entryFor(day.dow)}
    <div class="av-recurring-row" data-status={entry?.status ?? "none"}>
      <span class="av-dow" aria-label={day.long}>{day.short}</span>

      <SegmentedControl
        options={STATUS_OPTIONS}
        value={entry?.status ?? ""}
        name="av-status-{day.dow}"
        ariaLabel="Status für {day.long}"
        size="sm"
        {disabled}
        onchange={(v) => setStatus(day.dow, v as Status)}
      />

      <div class="av-actions">
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          {disabled}
          onclick={() => openEdit(day.dow)}
        >
          Notiz
        </button>
        {#if entry}
          <button
            type="button"
            class="btn btn-icon btn-ghost"
            aria-label="Eintrag für {day.long} entfernen"
            {disabled}
            onclick={() => askRemove(day.dow)}
          >
            <Icon name="trash" size={16} />
          </button>
        {/if}
      </div>
    </div>
  {/each}
</div>

<AvailabilityEditModal
  bind:open={editOpen}
  mode="recurring"
  initial={editInitial}
  onsave={handleEditSave}
  oncancel={handleEditCancel}
/>

<!-- The change itself is saved only through the page's SaveBar, so the text says „entfernt“, not
     „gelöscht“. -->
<ConfirmDialog
  bind:open={confirmOpen}
  title="Eintrag entfernen?"
  description="Dieser Verfügbarkeits-Eintrag wird entfernt. Bereits geplante Schichten bleiben unverändert."
  confirmLabel="Entfernen"
  danger
  onConfirm={doRemove}
  onCancel={cancelRemove}
/>

<style>
  .av-empty {
    color: var(--text-2);
    font-size: 0.9375rem;
    margin: 0 0 var(--s-3);
  }

  /* One container border with row dividers; the rows carry no card of their own. */
  .av-recurring-rows {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line);
    border-radius: var(--r-control);
    overflow: hidden;
  }

  .av-recurring-row {
    display: grid;
    grid-template-columns: 48px 1fr auto;
    align-items: center;
    gap: var(--s-3);
    min-height: var(--h-row);
    padding: var(--s-2) var(--s-3);
    border-bottom: 1px solid var(--line);
    border-left: 3px solid transparent;
  }
  .av-recurring-row:last-child {
    border-bottom: none;
  }
  /* The status edge: a data attribute, never an inline colour. */
  .av-recurring-row[data-status="AVAILABLE"] {
    border-left-color: var(--ok);
  }
  .av-recurring-row[data-status="UNAVAILABLE"] {
    border-left-color: var(--bad);
  }
  .av-recurring-row[data-status="PREFERRED"] {
    border-left-color: var(--brand);
  }

  .av-dow {
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 700;
    color: var(--text);
  }

  .av-actions {
    display: flex;
    gap: var(--s-1);
    align-items: center;
  }

  /* Phone (Issue #991 N-27): the day and its actions on one line, the three options in one line under
     it over the full width. */
  @media (max-width: 480px) {
    .av-recurring-row {
      grid-template-columns: 1fr auto;
      grid-template-areas:
        "dow actions"
        "control control";
      row-gap: var(--s-2);
    }
    .av-dow {
      grid-area: dow;
    }
    :global(.av-recurring-row .seg-control) {
      grid-area: control;
      width: 100%;
    }
    .av-actions {
      grid-area: actions;
      justify-content: flex-end;
    }
  }

  /* Touch devices: force 44px min hit target (WCAG 2.5.5) */
  @media (pointer: coarse) {
    .av-recurring-row {
      min-height: 44px;
    }
  }
</style>
