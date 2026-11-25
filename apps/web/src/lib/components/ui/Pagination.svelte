<script lang="ts">
  // Issue #1028 - legacy delegate of the shared `Pager` (block 5 / block 6 sub-part). The props of the
  // old `Pagination` stay, so a page that pages its own rows keeps working; the markup, the styles and
  // the „Seite x von y“ text are gone: every pager of the app is the one `Pager` now. A tenant page
  // passes `listId` and gets the stored size of the register (table sizes); without it the old
  // `pageSizeOptions` apply and nothing is stored (operator tables).
  import Pager from "./Pager.svelte";
  import { listPrefs, saveListPreference } from "$stores/list-prefs";
  import { pageSizesOf, resolveListPreference, type ListId } from "$lib/lists/list-registry";

  interface Props {
    total: number;
    page?: number;
    pageSize?: number;
    pageSizeOptions?: number[];
    labelSingular?: string;
    labelPlural?: string;
    showWhenSinglePage?: boolean;
    onChange?: (p: { page: number; pageSize: number }) => void;
    /** Issue #1028 (additive): the register id; the size is then stored per list and person. */
    listId?: ListId;
  }

  let {
    total,
    page = $bindable(1),
    pageSize = $bindable(10),
    pageSizeOptions = [10, 25, 50],
    labelSingular = "Eintrag",
    labelPlural = "Einträge",
    showWhenSinglePage = false,
    onChange,
    listId,
  }: Props = $props();

  const sizes = $derived(listId ? pageSizesOf(listId) : pageSizeOptions);

  // With a `listId` the stored (or default) size decides; the caller's bound `pageSize` follows it.
  const storedSize = $derived(
    listId ? resolveListPreference(listId, $listPrefs[listId]).pageSize : null,
  );
  $effect.pre(() => {
    if (storedSize !== null && pageSize !== storedSize) pageSize = storedSize;
  });

  function setSize(next: number) {
    pageSize = next;
    if (listId) void saveListPreference(listId, { pageSize: next });
  }
</script>

<Pager
  {total}
  bind:page
  bind:pageSize={() => pageSize, setSize}
  {sizes}
  noun={{ one: labelSingular, many: labelPlural }}
  {showWhenSinglePage}
  {onChange}
/>
