<script lang="ts">
  // Issue #1028 (block 5 „Liste“ and block 6 „Tabelle + Toolbar“, sub-part) - the one pager of every
  // list: „1–5 von 44“ in a polite live region, ‹ › buttons and the page-size choice. It owns no row
  // and no storage; the caller slices its rows with `pageSlice()` and stores the chosen size through
  // `saveListPreference()` (`ListWidget` and `DataTable` do both).
  //
  // Hidden while every row fits the smallest size, so a short list looks as it did before paging.
  import { clampPage, pageCount, rangeLabel } from "$lib/lists/list-page";

  interface Props {
    /** Number of rows over all pages. */
    total: number;
    /** One-based current page. */
    page?: number;
    /** Rows per page; one of `sizes`. */
    pageSize?: number;
    /** The sizes offered (the register's sizes of the list's kind). */
    sizes: readonly number[];
    /** Optional word after the range („Einträge“), for the legacy `Pagination` delegate. */
    noun?: { one: string; many: string };
    /** Called after a page or a size change with the new values. */
    onChange?: (change: { page: number; pageSize: number }) => void;
    /** `data-testid` of the `nav`. */
    testId?: string;
    /** Shows the pager although the rows fit one page (the `Pagination` delegate's old switch). */
    showWhenSinglePage?: boolean;
  }

  let {
    total,
    page = $bindable(1),
    pageSize = $bindable(10),
    sizes,
    noun,
    onChange,
    testId,
    showWhenSinglePage = false,
  }: Props = $props();

  const uid = $props.id();

  const pages = $derived(pageCount(total, pageSize));
  const current = $derived(clampPage(page, total, pageSize));
  const visible = $derived(showWhenSinglePage || total > Math.min(...sizes));
  const range = $derived(
    rangeLabel(current, pageSize, total) + (noun ? ` ${total === 1 ? noun.one : noun.many}` : ""),
  );

  function go(next: number) {
    page = clampPage(next, total, pageSize);
    onChange?.({ page, pageSize });
  }

  function onSizeChange(event: Event) {
    const next = Number((event.currentTarget as HTMLSelectElement).value);
    if (!sizes.includes(next)) return;
    pageSize = next;
    page = 1;
    onChange?.({ page, pageSize });
  }
</script>

{#if visible}
  <nav class="pager" aria-label="Seitennavigation" data-testid={testId}>
    <span class="pager-range" aria-live="polite" aria-atomic="true" data-testid="pager-range"
      >{range}</span
    >
    <div class="pager-controls">
      <label class="pager-size-label" for="{uid}-size">Zeilen pro Seite</label>
      <select id="{uid}-size" class="pager-select" onchange={onSizeChange}>
        {#each sizes as size (size)}
          <option value={size} selected={size === pageSize}>{size}</option>
        {/each}
      </select>
      <button
        type="button"
        class="pager-btn"
        disabled={current <= 1}
        onclick={() => go(current - 1)}
        aria-label="Vorherige Seite"
      >
        <span aria-hidden="true">‹</span>
      </button>
      <button
        type="button"
        class="pager-btn"
        disabled={current >= pages}
        onclick={() => go(current + 1)}
        aria-label="Nächste Seite"
      >
        <span aria-hidden="true">›</span>
      </button>
    </div>
  </nav>
{/if}

<style>
  .pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--s-2) var(--s-3);
    padding: var(--s-3) var(--s-4);
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .pager-range {
    color: var(--text);
    font-weight: 500;
    white-space: nowrap;
  }
  .pager-controls {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .pager-size-label {
    white-space: nowrap;
  }
  .pager-select {
    box-sizing: border-box;
    height: var(--h-control-sm);
    min-width: 4rem;
    padding: 0 var(--s-2);
    font: inherit;
    color: var(--text);
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--r-control);
  }
  .pager-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: var(--h-control-sm);
    height: var(--h-control-sm);
    padding: 0;
    font: inherit;
    font-size: var(--fs-base);
    line-height: 1;
    color: var(--text);
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--r-control);
    cursor: pointer;
  }
  .pager-btn:hover:not(:disabled) {
    background: var(--sunk);
  }
  .pager-btn:disabled {
    color: var(--text-3);
    cursor: default;
    opacity: 0.6;
  }
  .pager-btn:focus-visible,
  .pager-select:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }
  /* WCAG 2.5.5 - 44px min hit target on touch devices */
  @media (pointer: coarse) {
    .pager-btn,
    .pager-select {
      min-height: 44px;
    }
    .pager-btn {
      min-width: 44px;
    }
  }
</style>
