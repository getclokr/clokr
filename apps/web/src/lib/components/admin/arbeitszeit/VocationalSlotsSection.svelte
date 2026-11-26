<!--
  VocationalSlotsSection - „Berufsschule“ of Regeln › Arbeitszeit & Verträge (Issue #854): the time
  credit for Berufsschule days company-wide (§ 15 Abs. 2 BBiG). Moved from the System page; one
  SaveBar sends the four keys of the registry section `arbeitszeit-berufsschule` to
  `PUT /settings/work` (#878). An empty field sends an explicit null, which clears the company value
  so the person's own daily Soll applies; the server may answer non-blocking warnings, shown after
  the save. Issue #994 (N-12): the credits are entered in hours like every other amount of working
  time, the state, the bounds and the wire body stay whole minutes.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { api } from "$api/client";
  import { toasts } from "$stores/toast";
  import FormField from "$components/ui/FormField.svelte";
  import Note from "$components/ui/Note.svelte";
  import SettingsGroup from "$lib/components/admin/settings/SettingsGroup.svelte";
  import { countChanges, pickSection } from "$lib/settings/section-state";
  import { settingsSection } from "$lib/settings/settings-pages";
  import {
    VOCATIONAL_SLOT_FIELDS,
    messageCount,
    hoursFieldValue,
    minutesAsHours,
    minutesFromHoursField,
    vocationalSlotsFrom,
    vocationalSlotsMessages,
    vocationalSlotsWire,
    type VocationalSlotsField,
    type VocationalSlotsValues,
    type WorkConfig,
  } from "$lib/settings/arbeitszeit";

  interface Props {
    config: WorkConfig;
    canEdit?: boolean;
    changes?: number;
  }

  // `changes` is write-only here: the parent reads it through `bind:changes`.
  // eslint-disable-next-line no-useless-assignment
  let { config, canEdit = true, changes = $bindable(0) }: Props = $props();

  let snapshot = $state<VocationalSlotsValues>(untrack(() => vocationalSlotsFrom(config)));
  let values = $state<VocationalSlotsValues>(untrack(() => vocationalSlotsFrom(config)));
  let saving = $state(false);
  let warnings = $state<string[]>([]);

  const keys = settingsSection("arbeitszeit-berufsschule").keys as readonly VocationalSlotsField[];
  const changeCount = $derived(countChanges(snapshot, values, keys));
  const messages = $derived(vocationalSlotsMessages(values));
  const errorCount = $derived(messageCount(messages));

  $effect(() => {
    changes = changeCount;
  });

  async function save() {
    if (errorCount > 0) {
      toasts.error("Bitte prüf die markierten Felder.");
      return;
    }
    saving = true;
    warnings = [];
    try {
      const answer = await api.put<{ warnings?: string[] } | undefined>(
        "/settings/work",
        pickSection(
          vocationalSlotsWire(values) as Record<string, unknown>,
          settingsSection("arbeitszeit-berufsschule").keys,
        ),
      );
      // Over-crediting warnings (SC-3) are non-blocking: the values are saved, the person is told.
      warnings = answer?.warnings ?? [];
      snapshot = $state.snapshot(values);
      toasts.success("Berufsschule gespeichert.");
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      saving = false;
    }
  }

  function discard() {
    values = $state.snapshot(snapshot);
  }
</script>

<SettingsGroup
  title="Berufsschule"
  hint={[
    "Zeitgutschrift für Berufsschultage im ganzen Unternehmen.",
    "Ein leeres Feld nimmt das Tages-Soll der Person. Ein Tag zählt 4 bis 10 Stunden, eine Blockwoche 20 bis 50 Stunden.",
    "Grundlage: § 15 Abs. 2 BBiG.",
  ]}
  changes={changeCount}
  errors={errorCount}
  {saving}
  saveLabel="Zeitgutschrift speichern"
  onSave={save}
  onDiscard={discard}
>
  <p class="vs-intro">
    Die Werte gelten für jede Person ohne eigenen Wert. Änderungen wirken nur auf offene und
    künftige Monate.
  </p>

  {#each warnings as warning (warning)}
    <div role="alert"><Note tone="warn">{warning}</Note></div>
  {/each}

  {#each VOCATIONAL_SLOT_FIELDS as slot (slot.key)}
    <FormField
      label={slot.label}
      help={values[slot.key] === null
        ? "Leer: Der Wert kommt aus dem Tages-Soll der Person."
        : minutesAsHours(values[slot.key])}
      error={messages[slot.key]}
    >
      {#snippet field({ id, describedBy, invalid })}
        <div class="vs-row">
          <input
            {id}
            class="form-input"
            type="number"
            inputmode="decimal"
            min={slot.min / 60}
            max={slot.max / 60}
            step="0.25"
            bind:value={
              () => hoursFieldValue(values[slot.key]),
              (hours) => (values[slot.key] = minutesFromHoursField(hours))
            }
            disabled={!canEdit || saving}
            data-testid={`arbeitszeit-berufsschule-${slot.testid}`}
            aria-invalid={invalid ? "true" : undefined}
            aria-describedby={describedBy}
          />
          {#if values[slot.key] !== null && canEdit}
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              disabled={saving}
              onclick={() => (values[slot.key] = null)}
              aria-label={`${slot.name} leeren und aus dem Tages-Soll nehmen`}
            >
              Leeren
            </button>
          {/if}
        </div>
      {/snippet}
    </FormField>
  {/each}
</SettingsGroup>

<style>
  .vs-intro {
    margin: 0;
    font-size: var(--fs-sm);
    line-height: 1.5;
    color: var(--text-2);
  }

  .vs-row {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }

  .vs-row input {
    max-width: 14rem;
  }
</style>
