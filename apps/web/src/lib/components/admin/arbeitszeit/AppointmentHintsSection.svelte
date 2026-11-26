<!--
  AppointmentHintsSection - „Abgleich mit Terminen“ of Regeln › Arbeitszeit & Verträge (Issue #604):
  the tenant switch of the hint on probably unrecorded time. Off by default for every tenant (Art. 25
  Abs. 2 DSGVO); a company with a works council agrees the comparison with it first (§ 87 Abs. 1 Nr. 6
  BetrVG). One SaveBar sends the single key `appointmentTimeHintsEnabled` (registry section
  `arbeitszeit-terminabgleich`) to `PUT /settings/work`.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { api } from "$api/client";
  import { toasts } from "$stores/toast";
  import SettingsGroup from "$lib/components/admin/settings/SettingsGroup.svelte";
  import ToggleField from "$lib/components/admin/settings/ToggleField.svelte";
  import { countChanges, pickSection } from "$lib/settings/section-state";
  import { settingsSection } from "$lib/settings/settings-pages";
  import {
    appointmentHintsFrom,
    appointmentHintsWire,
    type AppointmentHintField,
    type AppointmentHintValues,
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

  let snapshot = $state<AppointmentHintValues>(untrack(() => appointmentHintsFrom(config)));
  let values = $state<AppointmentHintValues>(untrack(() => appointmentHintsFrom(config)));
  let saving = $state(false);

  const keys = settingsSection("arbeitszeit-terminabgleich")
    .keys as readonly AppointmentHintField[];
  const changeCount = $derived(countChanges(snapshot, values, keys));

  $effect(() => {
    changes = changeCount;
  });

  async function save() {
    saving = true;
    try {
      await api.put(
        "/settings/work",
        pickSection(
          appointmentHintsWire(values) as Record<string, unknown>,
          settingsSection("arbeitszeit-terminabgleich").keys,
        ),
      );
      snapshot = $state.snapshot(values);
      toasts.success("Abgleich mit Terminen gespeichert.");
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
  title="Abgleich mit Terminen"
  hint="Hinweis auf vermutlich nicht erfasste Arbeitszeit aus den Phorest-Terminen."
  changes={changeCount}
  errors={0}
  {saving}
  saveLabel="Abgleich speichern"
  onSave={save}
  onDiscard={discard}
>
  <ToggleField
    bind:checked={values.appointmentTimeHintsEnabled}
    label="Termine mit der erfassten Zeit abgleichen"
    hint={[
      "Ist der Abgleich an, sehen Mitarbeitende unter Mein Tag und Zeiten einen Hinweis, wenn ihr letzter Termin eines vergangenen Tages mehr als 15 Minuten nach dem Ausstempeln endet oder sie an einem Tag Termine, aber keine Zeit erfasst haben.",
      "Unter Aufgaben sieht ihn, wer die Zeiten der Person sehen darf.",
      "Clokr trägt nie selbst Zeit ein und ändert kein Stundenkonto.",
      "Gibt es in deinem Unternehmen einen Betriebsrat, stimm den Abgleich vorher mit ihm ab (§ 87 Abs. 1 Nr. 6 BetrVG).",
      "Deine Mitarbeitenden sehen in ihrem Profil, dass abgeglichen wird (Art. 13 DSGVO).",
    ]}
    disabled={!canEdit || saving}
    testid="arbeitszeit-terminabgleich-enabled"
  />
</SettingsGroup>
