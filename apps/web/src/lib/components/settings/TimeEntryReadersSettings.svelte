<script lang="ts">
  // Issue #606: „Wer sieht meine Zeiten?“ - the roles that can read the caller's own time entries.
  // The rows come only from GET /me/time-entry-readers (derived on the server from the stored role
  // assignments and the real read rule); the web holds no list of roles, only the German wording of
  // the server's coverage and purpose ids (`$lib/transparency/time-transparency`). No name, no id and
  // no head count is ever shown.
  import { onMount } from "svelte";
  import type { TimeEntryReadersResponse } from "@clokr/types";
  import { fetchTimeEntryReaders } from "$api/time-entry-readers";
  import { salonContext } from "$stores/salon-context";
  import Section from "$lib/components/admin/Section.svelte";
  import Skeleton from "$components/ui/Skeleton.svelte";
  import EmptyState from "$components/ui/EmptyState.svelte";
  import ErrorState from "$components/ui/ErrorState.svelte";
  import List from "$components/ui/List.svelte";
  import ListRow from "$components/ui/ListRow.svelte";
  import Note from "$components/ui/Note.svelte";
  import {
    COVERAGE_TEXT,
    PROGRAMS_TEXT,
    READERS_TEXT,
    purposeLine,
  } from "$lib/transparency/time-transparency";

  let loading = $state(true);
  let failed = $state(false);
  let retrying = $state(false);
  let answer = $state<TimeEntryReadersResponse | null>(null);

  const homeSalon = $derived.by(() => {
    const id = $salonContext.homeSalonId;
    if (!id) return null;
    return $salonContext.salons.find((s) => s.id === id)?.name ?? null;
  });

  function coverageText(coverage: keyof typeof COVERAGE_TEXT): string {
    const text = COVERAGE_TEXT[coverage];
    return coverage === "homeSalon" && homeSalon ? `${text} (${homeSalon})` : text;
  }

  async function load() {
    try {
      answer = await fetchTimeEntryReaders();
      failed = false;
    } catch {
      failed = true;
    } finally {
      loading = false;
      retrying = false;
    }
  }

  function retry() {
    retrying = true;
    void load();
  }

  onMount(load);

  const isEmpty = $derived(
    answer !== null && answer.groups.length === 0 && !answer.connectedPrograms,
  );
</script>

<div id="wer-sieht-meine-zeiten">
  <Section title={READERS_TEXT.title} hint={READERS_TEXT.hint}>
    {#if loading}
      <Skeleton shape="block" height="96px" />
    {:else if failed}
      <ErrorState message={READERS_TEXT.loadError} onRetry={retry} {retrying} />
    {:else if answer}
      <p class="intro">{READERS_TEXT.intro}</p>
      {#if isEmpty}
        <EmptyState title={READERS_TEXT.empty} />
      {:else}
        <List ariaLabel={READERS_TEXT.listLabel} testId="time-entry-readers">
          {#each answer.groups as group (`${group.roleName}:${group.coverage}`)}
            <ListRow
              title={group.roleName}
              subtitle={coverageText(group.coverage)}
              avatar={false}
              wrap
              kind={group.coverage}
            >
              {#snippet meta()}<span class="purpose">{purposeLine(group.purposes)}</span>{/snippet}
            </ListRow>
          {/each}
          {#if answer.connectedPrograms}
            <ListRow
              title={PROGRAMS_TEXT.title}
              subtitle={PROGRAMS_TEXT.subtitle}
              avatar={false}
              wrap
              kind="programs"
            >
              {#snippet meta()}<span class="purpose">{PROGRAMS_TEXT.purpose}</span>{/snippet}
            </ListRow>
          {/if}
        </List>
      {/if}
      <div class="support-note">
        <Note tone="info">{PROGRAMS_TEXT.supportNote}</Note>
      </div>
    {/if}
  </Section>
</div>

<style>
  .intro {
    margin: 0 0 var(--s-3);
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .support-note {
    margin-top: var(--s-3);
  }
  .purpose {
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
</style>
