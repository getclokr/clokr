<script lang="ts" generics="T">
  // Issue #1028 (block 5 „Liste“, sub-part) - the shared list widget of Heute im Salon and Mein Tag:
  // a head (title, optional „mehr“ link), optional filter chips with counts, the rows of ONE page and the
  // `Pager`. The page size and the filter a person picks are stored per list and person through
  // `PUT /me/preferences` (`saveListPreference`, key `lists`, register
  // `packages/types/list-preferences.json`); nothing is kept in the browser storage. A missing or
  // invalid stored value shows the list's default.
  //
  // The caller owns the rows and the numbers: `items` is already filtered by the bindable `filter`
  // (the widget only reports the choice) and every chip count comes from the caller, from data it
  // already loaded - the widget never recomputes a figure of the server (AC4).
  //
  // The body keeps its height while paging: it reserves `pageSize` rows (an estimate from `rowHeight`,
  // raised to the tallest page seen for this size and filter), so the neighbouring widgets do not jump.
  import { untrack, type Snippet } from "svelte";
  import { RadioGroup } from "bits-ui";
  import List from "./List.svelte";
  import Pager from "./Pager.svelte";
  import Skeleton from "./Skeleton.svelte";
  import { listPrefs, saveListPreference } from "$stores/list-prefs";
  import {
    filtersOf,
    pageSizesOf,
    resolveListPreference,
    type ListId,
  } from "$lib/lists/list-registry";
  import { clampPage, pageSlice } from "$lib/lists/list-page";

  interface FilterChip {
    /** Control value of the filter (a status, a kind, a code), never shown. */
    value: string;
    /** German label of the chip. */
    label: string;
    /** How many rows the filter holds; the caller's number. */
    count?: number;
  }

  interface Props {
    /** The id of the register; it names the stored size and filter. */
    listId: ListId;
    title: string;
    /** Every row of the list (after the filter), not only the shown page. */
    items: readonly T[];
    /** A unique key per row. */
    itemKey: (item: T) => string;
    /** The chips; the first chip with the value „alle“ is the fallback of an unknown value. */
    filters?: readonly FilterChip[];
    /** The effective filter (the shown chip); set by the widget, read by the caller to filter `items`. */
    filter?: string;
    /** A filter of the URL that wins for this visit (a Kennzahl link); a chip click replaces it. */
    initialFilter?: string;
    /** Called after the person clicked a chip (the page drops its URL filter here). */
    onFilterChange?: (value: string) => void;
    /** The head link „mehr“ to the full page. */
    moreHref?: string;
    moreLabel?: string;
    /** One row; rendered inside `List`. */
    row?: Snippet<[T]>;
    /** The whole body of a page (a table widget); receives the rows of the shown page. */
    body?: Snippet<[T[]]>;
    /** The calm text when `items` is empty. */
    empty?: Snippet;
    loading?: boolean;
    /** `data-testid` of the section and of the chip group. */
    testId?: string;
    filterTestId?: string;
    /** Estimated row height in px for the reserved body height. */
    rowHeight?: number;
    /** Accessible name of the row list; defaults to the title. */
    ariaLabel?: string;
  }

  let {
    listId,
    title,
    items,
    itemKey,
    filters,
    filter = $bindable(),
    initialFilter,
    onFilterChange,
    moreHref,
    moreLabel = "Alle anzeigen",
    row,
    body,
    empty,
    loading = false,
    testId,
    filterTestId,
    rowHeight = 48,
    ariaLabel,
  }: Props = $props();

  const uid = $props.id();

  const stored = $derived($listPrefs[listId]);
  const resolved = $derived(resolveListPreference(listId, stored));
  const sizes = $derived(pageSizesOf(listId));
  const pageSize = $derived(resolved.pageSize);
  const hasFilter = $derived(filtersOf(listId) !== undefined || resolved.filter !== null);

  // A chip click (or a URL filter) of this visit; until then the stored choice decides.
  let picked = $state<string | null>(null);
  const wanted = $derived(picked ?? initialFilter ?? resolved.filter ?? "alle");

  /**
   * The effective filter: the wanted one when a chip offers it, else „alle“ - without touching the
   * stored value (a kind that is not offered today may be again tomorrow).
   */
  const effective = $derived.by(() => {
    if (!filters || filters.length === 0) return wanted;
    if (filters.some((f) => f.value === wanted)) return wanted;
    return filters.find((f) => f.value === "alle")?.value ?? filters[0].value;
  });

  $effect.pre(() => {
    if (filter !== effective) filter = effective;
  });

  let page = $state(1);
  const shownPage = $derived(clampPage(page, items.length, pageSize));
  const pageItems = $derived(pageSlice(items, shownPage, pageSize));
  const paged = $derived(items.length > Math.min(...sizes));

  // The reserved body height: an estimate, raised to the tallest page seen for this size and filter.
  // Measured after each render (no ResizeObserver: the page set only changes through this component's
  // own state or a new `items` array, both re-run the effect).
  let bodyEl = $state<HTMLElement | null>(null);
  let tallest = $state(0);
  let tallestKey = "";
  $effect(() => {
    const key = `${pageSize}|${effective}`;
    // Track what changes the rendered rows.
    void pageItems;
    if (key !== tallestKey) {
      tallestKey = key;
      tallest = 0;
    }
    const measured = bodyEl?.offsetHeight ?? 0;
    if (paged && measured > untrack(() => tallest)) tallest = measured;
  });
  const minHeight = $derived(paged ? Math.max(pageSize * rowHeight, tallest) : 0);

  function entry(over: { pageSize?: number; filter?: string }) {
    const out: { pageSize: number; filter?: string } = { pageSize: over.pageSize ?? pageSize };
    if (hasFilter) out.filter = over.filter ?? picked ?? resolved.filter ?? undefined;
    if (out.filter === undefined) delete out.filter;
    return out;
  }

  function pickFilter(value: string) {
    if (value === effective) return;
    picked = value;
    page = 1;
    onFilterChange?.(value);
    void saveListPreference(listId, entry({ filter: value }));
  }

  function changeSize(change: { page: number; pageSize: number }) {
    page = change.page;
    if (change.pageSize !== pageSize) {
      void saveListPreference(listId, entry({ pageSize: change.pageSize }));
    }
  }
</script>

<section class="lw" aria-labelledby="{uid}-title" data-testid={testId}>
  <header class="lw-head">
    <h2 id="{uid}-title" class="lw-title">{title}</h2>
    {#if moreHref}
      <a class="lw-more" href={moreHref}>{moreLabel}</a>
    {/if}
  </header>

  {#if filters && filters.length > 0}
    <RadioGroup.Root
      class="lw-chips"
      aria-label="Filter: {title}"
      value={effective}
      onValueChange={pickFilter}
      data-testid={filterTestId}
    >
      {#each filters as chip (chip.value)}
        <RadioGroup.Item value={chip.value}>
          {#snippet child({ props, checked })}
            <button {...props} class="lw-chip" class:lw-chip--on={checked} type="button">
              <span>{chip.label}</span>
              {#if chip.count !== undefined}<span class="lw-chip-count">{chip.count}</span>{/if}
            </button>
          {/snippet}
        </RadioGroup.Item>
      {/each}
    </RadioGroup.Root>
  {/if}

  <div
    class="lw-body"
    style:min-height={minHeight > 0 ? `${minHeight}px` : undefined}
    bind:this={bodyEl}
  >
    {#if loading}
      <Skeleton shape="row" count={4} />
    {:else if items.length === 0}
      {@render empty?.()}
    {:else if body}
      {@render body(pageItems)}
    {:else if row}
      <List ariaLabel={ariaLabel ?? title}>
        {#each pageItems as item (itemKey(item))}
          {@render row(item)}
        {/each}
      </List>
    {/if}
  </div>

  {#if !loading}
    <Pager
      total={items.length}
      page={shownPage}
      {pageSize}
      {sizes}
      onChange={changeSize}
      testId={testId ? `${testId}-pager` : undefined}
    />
  {/if}
</section>

<style>
  .lw {
    min-width: 0;
    scroll-margin-top: 64px;
  }
  .lw-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-2);
    margin: 0 0 var(--s-2);
  }
  .lw-title {
    margin: 0;
    font-size: var(--fs-h2);
    font-weight: 600;
  }
  .lw-more {
    font-size: var(--fs-sm);
    font-weight: 500;
    color: var(--brand);
    white-space: nowrap;
  }
  .lw :global(.lw-chips) {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1) var(--s-2);
    margin: 0 0 var(--s-3);
  }
  .lw-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    min-height: var(--h-control-sm);
    padding: 0 var(--s-3);
    font: inherit;
    font-size: var(--fs-sm);
    color: var(--text-2);
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
    cursor: pointer;
    white-space: nowrap;
  }
  .lw-chip:hover {
    color: var(--text);
    background: var(--sunk);
  }
  .lw-chip--on {
    color: var(--text);
    font-weight: 600;
    background: var(--brand-tint);
    border-color: var(--brand);
  }
  .lw-chip:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }
  .lw-chip-count {
    font-variant-numeric: tabular-nums;
    color: var(--text-2);
  }
  .lw-body {
    min-width: 0;
  }
  @media (pointer: coarse) {
    .lw-chip {
      min-height: 44px;
    }
  }
</style>
