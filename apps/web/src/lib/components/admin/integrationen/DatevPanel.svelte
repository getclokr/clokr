<!--
  DatevPanel - the „DATEV“ tab of Verwalten › System › Integrationen (Issue #951; the numbers used to sit on
  Daten › Export, which now only downloads). Registry section `export-datev-einrichtung`: Berater-Nr.,
  Mandantennummer and the four Lohnarten; the save sends exactly those six keys to `PUT /settings/work` and the
  panel keeps no copy of the other settings (#878). The section keeps the permission alternatives of the
  export page it came from (`report:export`, D-854-05).

  A cleared Berater- or Mandantennummer is an explicit null („nicht eingerichtet“), which the API accepts for
  these two only; the DATEV export is refused while either is unset.

  Props:
    active - true while the tab is the selected one
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { api } from "$api/client";
  import { authStore } from "$stores/auth";
  import { markUnsaved } from "$stores/unsaved";
  import { toasts } from "$stores/toast";
  import { hasPermission } from "$lib/permissions";
  import { countChanges, pickSection } from "$lib/settings/section-state";
  import { settingsSection } from "$lib/settings/settings-pages";
  import { wholeNumberProblem } from "$lib/export/export-centre";
  import SettingsGroup from "$lib/components/admin/settings/SettingsGroup.svelte";
  import FormField from "$components/ui/FormField.svelte";
  import Note from "$components/ui/Note.svelte";
  import Skeleton from "$components/ui/Skeleton.svelte";

  interface Props {
    active: boolean;
  }

  let { active }: Props = $props();

  const user = $derived($authStore.user);
  const canEditSettings = $derived(hasPermission(user, "tenant-settings:update:ZUGEWIESEN"));

  interface DatevConfig {
    datevNormalstundenNr?: number;
    datevUrlaubNr?: number;
    datevKrankNr?: number;
    datevSonderurlaubNr?: number;
    // No default: null means "not configured", and the export refuses to run (409) rather than shipping 0/0.
    datevBeraterNr?: number | null;
    datevMandantenNr?: number | null;
  }
  type DatevValues = {
    datevBeraterNr: number | null;
    datevMandantenNr: number | null;
    datevNormalstundenNr: number | null;
    datevUrlaubNr: number | null;
    datevKrankNr: number | null;
    datevSonderurlaubNr: number | null;
  };

  const datevFrom = (c: DatevConfig): DatevValues => ({
    datevBeraterNr: typeof c.datevBeraterNr === "number" ? c.datevBeraterNr : null,
    datevMandantenNr: typeof c.datevMandantenNr === "number" ? c.datevMandantenNr : null,
    datevNormalstundenNr: Number(c.datevNormalstundenNr ?? 100),
    datevUrlaubNr: Number(c.datevUrlaubNr ?? 300),
    datevKrankNr: Number(c.datevKrankNr ?? 200),
    datevSonderurlaubNr: Number(c.datevSonderurlaubNr ?? 302),
  });

  let datev = $state<DatevValues>(datevFrom({}));
  let datevSnapshot = $state<DatevValues>(datevFrom({}));
  let datevSaving = $state(false);
  let datevLoadError = $state("");
  // Gated on "the baseline has been taken": a failed load must not arm the navigation guard on a page whose
  // save provably cannot write.
  let snapshotsReady = $state(false);
  let loading = $state(false);

  const datevKeys = settingsSection("export-datev-einrichtung")
    .keys as readonly (keyof DatevValues)[];
  const datevChanges = $derived(countChanges(datevSnapshot, datev, datevKeys));

  const datevProblems = $derived({
    datevBeraterNr: wholeNumberProblem("Berater-Nr.", datev.datevBeraterNr, {
      min: 1,
      max: 9999999,
      optional: true,
    }),
    datevMandantenNr: wholeNumberProblem("Mandantennummer", datev.datevMandantenNr, {
      min: 1,
      max: 99999,
      optional: true,
    }),
    datevNormalstundenNr: wholeNumberProblem("Normalstunden", datev.datevNormalstundenNr, {
      min: 1,
      max: 9999,
    }),
    datevUrlaubNr: wholeNumberProblem("Urlaub", datev.datevUrlaubNr, { min: 1, max: 9999 }),
    datevKrankNr: wholeNumberProblem("Krank / AU", datev.datevKrankNr, { min: 1, max: 9999 }),
    datevSonderurlaubNr: wholeNumberProblem("Sonderurlaub", datev.datevSonderurlaubNr, {
      min: 1,
      max: 9999,
    }),
  });
  const datevErrorCount = $derived(Object.values(datevProblems).filter((p) => p !== null).length);

  $effect(() => {
    markUnsaved("integrationen-datev", snapshotsReady && datevChanges > 0);
    return () => markUnsaved("integrationen-datev", false);
  });

  async function loadDatev() {
    loading = true;
    try {
      const cfg = await api.get<DatevConfig>("/settings/work");
      datev = datevFrom(cfg);
      datevSnapshot = datevFrom(cfg);
      snapshotsReady = true;
    } catch (e: unknown) {
      datevLoadError =
        e instanceof Error ? e.message : "Die DATEV-Einrichtung konnte nicht geladen werden.";
    } finally {
      loading = false;
    }
  }

  async function saveDatev() {
    if (!snapshotsReady || datevErrorCount > 0) return;
    datevSaving = true;
    try {
      // Exactly the six keys of the registry section: a cleared Berater- or Mandantennummer is an explicit
      // null ("not configured"), which the API accepts for these two only.
      await api.put(
        "/settings/work",
        pickSection(
          datev as Record<string, unknown>,
          settingsSection("export-datev-einrichtung").keys,
        ),
      );
      datevSnapshot = $state.snapshot(datev);
      toasts.success("DATEV-Einrichtung gespeichert.");
    } catch (e: unknown) {
      toasts.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      datevSaving = false;
    }
  }

  function discardDatev() {
    datev = $state.snapshot(datevSnapshot);
  }

  // Lazy load on the first visit of the tab: a person who never opens it costs no request.
  let started = false;
  $effect(() => {
    if (!active || started) return;
    started = true;
    untrack(() => void loadDatev());
  });
</script>

<SettingsGroup
  id="datev-einrichtung"
  title="DATEV"
  description="Berater-Nr., Mandantennummer und die Lohnarten für DATEV LODAS. Die Nummern gelten für jede erzeugte Datei."
  changes={datevChanges}
  errors={datevErrorCount}
  saving={datevSaving}
  saveLabel="DATEV-Einrichtung speichern"
  onSave={saveDatev}
  onDiscard={discardDatev}
>
  {#if datevLoadError}
    <div role="alert"><Note tone="bad">{datevLoadError}</Note></div>
  {:else if loading || !snapshotsReady}
    <Skeleton shape="card" lines={3} />
  {:else}
    {#if !canEditSettings}
      <Note tone="info"
        >Die Nummern kannst du nur ändern, wenn du die Einstellungen ändern darfst.</Note
      >
    {/if}
    <FormField
      label="Berater-Nr."
      help="Nummer der Steuerkanzlei im DATEV-Kopf. Ohne sie wird der Export abgelehnt."
      error={datevProblems.datevBeraterNr ?? undefined}
    >
      {#snippet field({ id, describedBy, invalid })}
        <input
          {id}
          type="number"
          min="1"
          max="9999999"
          step="1"
          class="form-input"
          bind:value={datev.datevBeraterNr}
          disabled={!canEditSettings || datevSaving}
          aria-describedby={describedBy}
          aria-invalid={invalid}
        />
      {/snippet}
    </FormField>
    <FormField
      label="Mandantennummer"
      help="Nummer dieses Unternehmens bei der Kanzlei. Ohne sie lässt sich die Datei keinem Unternehmen zuordnen."
      error={datevProblems.datevMandantenNr ?? undefined}
    >
      {#snippet field({ id, describedBy, invalid })}
        <input
          {id}
          type="number"
          min="1"
          max="99999"
          step="1"
          class="form-input"
          bind:value={datev.datevMandantenNr}
          disabled={!canEditSettings || datevSaving}
          aria-describedby={describedBy}
          aria-invalid={invalid}
        />
      {/snippet}
    </FormField>
    <FormField
      label="Normalstunden"
      help="Lohnart für reguläre Arbeitsstunden."
      error={datevProblems.datevNormalstundenNr ?? undefined}
    >
      {#snippet field({ id, describedBy, invalid })}
        <input
          {id}
          type="number"
          min="1"
          max="9999"
          step="1"
          class="form-input"
          bind:value={datev.datevNormalstundenNr}
          disabled={!canEditSettings || datevSaving}
          aria-describedby={describedBy}
          aria-invalid={invalid}
        />
      {/snippet}
    </FormField>
    <FormField
      label="Urlaub"
      help="Lohnart für genommene Urlaubstage."
      error={datevProblems.datevUrlaubNr ?? undefined}
    >
      {#snippet field({ id, describedBy, invalid })}
        <input
          {id}
          type="number"
          min="1"
          max="9999"
          step="1"
          class="form-input"
          bind:value={datev.datevUrlaubNr}
          disabled={!canEditSettings || datevSaving}
          aria-describedby={describedBy}
          aria-invalid={invalid}
        />
      {/snippet}
    </FormField>
    <FormField
      label="Krank / AU"
      help="Lohnart für entgeltfortzahlungspflichtige Krankheitstage."
      error={datevProblems.datevKrankNr ?? undefined}
    >
      {#snippet field({ id, describedBy, invalid })}
        <input
          {id}
          type="number"
          min="1"
          max="9999"
          step="1"
          class="form-input"
          bind:value={datev.datevKrankNr}
          disabled={!canEditSettings || datevSaving}
          aria-describedby={describedBy}
          aria-invalid={invalid}
        />
      {/snippet}
    </FormField>
    <FormField
      label="Sonderurlaub"
      help="Lohnart für Sonderurlaub nach § 616 BGB oder Tarif."
      error={datevProblems.datevSonderurlaubNr ?? undefined}
    >
      {#snippet field({ id, describedBy, invalid })}
        <input
          {id}
          type="number"
          min="1"
          max="9999"
          step="1"
          class="form-input"
          bind:value={datev.datevSonderurlaubNr}
          disabled={!canEditSettings || datevSaving}
          aria-describedby={describedBy}
          aria-invalid={invalid}
        />
      {/snippet}
    </FormField>
  {/if}
</SettingsGroup>
