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
  import Dialog from "$components/ui/Dialog.svelte";
  import { authStore } from "$stores/auth";
  import { hasPermission } from "$lib/permissions";
  import WhyClockIntroContent from "$lib/components/transparency/WhyClockIntroContent.svelte";
  import {
    COVERAGE_TEXT,
    PROGRAMS_TEXT,
    READERS_TEXT,
    WHY_CLOCK_TEXT,
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

  // The intro can be reopened by a person who can clock for themself (D-11); it writes nothing.
  let introOpen = $state(false);
  const canClock = $derived(hasPermission($authStore.user, "time-entry:create:EIGENE"));

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
    <p class="legal" data-testid="time-entry-readers-legal">{WHY_CLOCK_TEXT.legalBasis}</p>
    {#if canClock}
      <div class="reopen">
        <button type="button" class="btn btn-secondary btn-sm" onclick={() => (introOpen = true)}
          >{WHY_CLOCK_TEXT.reopen}</button
        >
      </div>
    {/if}
  </Section>
</div>

<!-- Reopen the intro (Issue #606, D-11): the same content, nothing is written. -->
<Dialog bind:open={introOpen} title={WHY_CLOCK_TEXT.title}>
  <WhyClockIntroContent onLinkClick={() => (introOpen = false)} />
  {#snippet footer()}
    <button type="button" class="btn btn-secondary" onclick={() => (introOpen = false)}
      >{WHY_CLOCK_TEXT.close}</button
    >
  {/snippet}
</Dialog>

<style>
  .intro {
    margin: 0 0 var(--s-3);
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .support-note {
    margin-top: var(--s-3);
  }
  .legal {
    margin: var(--s-3) 0 0;
    color: var(--text-2);
    font-size: var(--fs-sm);
    line-height: 1.5;
  }
  .reopen {
    margin-top: var(--s-3);
  }
  .purpose {
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
</style>
