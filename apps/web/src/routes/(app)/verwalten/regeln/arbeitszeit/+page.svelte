<!--
  Verwalten › Regeln › Arbeitszeit & Verträge (Issue #854, D-854-03): the working-time defaults of the
  whole company, one section per concern, each with its own SaveBar. The sections were moved here from
  the System and Urlaub pages - every setting lives exactly once (lib/settings/settings-pages.ts).

  The page loads `GET /settings/work` once and hands it to the sections; each section keeps its own
  snapshot and sends only its own fields (#878). A person sees a section only under the permission
  alternatives of the page it came from (D-854-05); the page itself opens under their union.

  Issue #951: grouped sections as five tabs (PageTabs, hash-addressable like Regeln › Abwesenheiten, e.g. `#pausen`),
  because the sections stacked made the page ~2,900 px long. Every panel stays in the DOM, so a draft in one
  tab survives a tab change and the unsaved-changes guard still counts it; each section keeps its own SaveBar.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { api } from "$api/client";
  import { authStore } from "$stores/auth";
  import { markUnsaved } from "$stores/unsaved";
  import { pageLabel } from "$lib/nav/page-labels";
  import { tabFromHash, writeTabHash } from "$lib/nav/tab-hash";
  import { mayOpenSection, settingsSection } from "$lib/settings/settings-pages";
  import { ARBEITSZEIT_TAB_ALIASES, visibleArbeitszeitTabs } from "$lib/settings/arbeitszeit-tabs";
  import type { WorkConfig } from "$lib/settings/arbeitszeit";
  import PageHead from "$lib/components/layout/PageHead.svelte";
  import Note from "$components/ui/Note.svelte";
  import PageTabs from "$components/ui/PageTabs.svelte";
  import Skeleton from "$components/ui/Skeleton.svelte";
  import BreaksSection from "$lib/components/admin/arbeitszeit/BreaksSection.svelte";
  import RetroWindowSection from "$lib/components/admin/arbeitszeit/RetroWindowSection.svelte";
  import AppointmentHintsSection from "$lib/components/admin/arbeitszeit/AppointmentHintsSection.svelte"; // Issue #604
  import WorkDaysSection from "$lib/components/admin/arbeitszeit/WorkDaysSection.svelte";
  import CoreHoursSection from "$lib/components/admin/arbeitszeit/CoreHoursSection.svelte";
  import VocationalSlotsSection from "$lib/components/admin/arbeitszeit/VocationalSlotsSection.svelte";
  import DefaultHoursSection from "$lib/components/admin/arbeitszeit/DefaultHoursSection.svelte";
  import MaxNegativeSection from "$lib/components/admin/arbeitszeit/MaxNegativeSection.svelte";
  import ComplianceSection from "$lib/components/admin/arbeitszeit/ComplianceSection.svelte";
  import OpenEntriesSection from "$lib/components/admin/arbeitszeit/OpenEntriesSection.svelte";

  let config = $state<WorkConfig | null>(null);
  let loadError = $state("");
  let loading = $state(true);

  // The unsaved counts of the sections, summed into ONE registration (a second registration under the
  // same id would let one section's cleanup disarm the others).
  const changes = $state({
    pausen: 0,
    rueckwirkend: 0,
    arbeitstage: 0,
    gleitzeit: 0,
    berufsschule: 0,
    standard: 0,
    ueberstunden: 0,
    compliance: 0,
    offeneEintraege: 0,
    terminabgleich: 0, // Issue #604
  });
  const totalChanges = $derived(Object.values(changes).reduce((sum, n) => sum + n, 0));

  // Gated on "the baseline has been taken": a failed load must not arm the navigation guard on a page
  // that shows nothing but an error.
  const snapshotsReady = $derived(config !== null && !loading && loadError === "");

  $effect(() => {
    markUnsaved("regeln-arbeitszeit", snapshotsReady && totalChanges > 0);
    return () => markUnsaved("regeln-arbeitszeit", false);
  });

  const user = $derived($authStore.user);
  const show = $derived({
    pausen: mayOpenSection(user, settingsSection("arbeitszeit-pausen")),
    rueckwirkend: mayOpenSection(user, settingsSection("arbeitszeit-rueckwirkend")),
    arbeitstage: mayOpenSection(user, settingsSection("arbeitszeit-arbeitstage")),
    gleitzeit: mayOpenSection(user, settingsSection("arbeitszeit-gleitzeit")),
    berufsschule: mayOpenSection(user, settingsSection("arbeitszeit-berufsschule")),
    standard: mayOpenSection(user, settingsSection("arbeitszeit-standard")),
    ueberstunden: mayOpenSection(user, settingsSection("arbeitszeit-ueberstunden")),
    compliance: mayOpenSection(user, settingsSection("arbeitszeit-compliance")),
    offeneEintraege: mayOpenSection(user, settingsSection("arbeitszeit-offene-eintraege")),
    terminabgleich: mayOpenSection(user, settingsSection("arbeitszeit-terminabgleich")), // Issue #604
  });
  const visibleTabs = $derived(visibleArbeitszeitTabs(user));
  const visibleTabIds = $derived(visibleTabs.map((tab) => tab.value as string));
  let activeTab = $state<string>("");

  function selectTab(next: string) {
    activeTab = next;
    writeTabHash(next);
  }

  onMount(async () => {
    activeTab =
      visibleTabIds.length > 0
        ? tabFromHash(page.url.hash, visibleTabIds, ARBEITSZEIT_TAB_ALIASES)
        : "";
    try {
      config = await api.get<WorkConfig>("/settings/work");
    } catch (err) {
      loadError =
        err instanceof Error ? err.message : "Die Einstellungen konnten nicht geladen werden.";
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>{pageLabel("/verwalten/regeln/arbeitszeit")} – Clokr</title>
</svelte:head>

<PageHead
  title={pageLabel("/verwalten/regeln/arbeitszeit")}
  hint="Diese Vorgaben gelten für alle im Unternehmen. Für einzelne Personen legst du sie im Vertrag der Person fest."
/>

{#if loading}
  <Skeleton shape="card" lines={4} />
{:else if loadError || config === null}
  <div role="alert"><Note tone="bad">{loadError}</Note></div>
{:else}
  <PageTabs
    tabs={visibleTabs.map(({ value, label }) => ({ value, label }))}
    tab={activeTab}
    onTabChange={selectTab}
    tabsLabel="Bereiche der Arbeitszeit"
  >
    {#snippet panel(value)}
      {#if value === "arbeitszeit"}
        {#if show.standard}
          <DefaultHoursSection config={config!} bind:changes={changes.standard} />
        {/if}
        {#if show.arbeitstage}
          <WorkDaysSection config={config!} bind:changes={changes.arbeitstage} />
        {/if}
        {#if show.gleitzeit}
          <CoreHoursSection config={config!} bind:changes={changes.gleitzeit} />
        {/if}
      {:else if value === "ueberstunden"}
        {#if show.ueberstunden}
          <MaxNegativeSection config={config!} bind:changes={changes.ueberstunden} />
        {/if}
      {:else if value === "pausen"}
        {#if show.pausen}
          <BreaksSection config={config!} bind:changes={changes.pausen} />
        {/if}
        {#if show.compliance}
          <ComplianceSection config={config!} bind:changes={changes.compliance} />
        {/if}
      {:else if value === "eintraege"}
        {#if show.offeneEintraege}
          <OpenEntriesSection config={config!} bind:changes={changes.offeneEintraege} />
        {/if}
        {#if show.rueckwirkend}
          <RetroWindowSection config={config!} bind:changes={changes.rueckwirkend} />
        {/if}
        {#if show.terminabgleich}
          <AppointmentHintsSection config={config!} bind:changes={changes.terminabgleich} />
        {/if}
      {:else if value === "berufsschule"}
        {#if show.berufsschule}
          <VocationalSlotsSection config={config!} bind:changes={changes.berufsschule} />
        {/if}
      {/if}
    {/snippet}
  </PageTabs>
{/if}
