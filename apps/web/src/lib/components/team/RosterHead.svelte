<script lang="ts">
  // Issue #992 (N-12, D-992-20) — the head of the four Dienstplan tabs (Woche, Bedarf, Hinweise,
  // Verfügbarkeit): the page head and the tab strip, once. Every tab page renders it at the TOP LEVEL
  // of its markup (never inside a `.page` wrapper), so heading, hint and tab row sit at the same height
  // on all four; the roster geometry spec measures exactly that. The component has no spacing of its
  // own: the spacing between head and strip is the blocks'.
  import type { Snippet } from "svelte";
  import PageHead from "$lib/components/layout/PageHead.svelte";
  import PageTabs from "$components/ui/PageTabs.svelte";
  import type { RosterTab } from "$lib/nav/routes";

  interface Props {
    /** The page name (from the route table). */
    title: string;
    /** The explanation behind the info symbol next to the heading. */
    hint: string;
    /** The href of the current tab. */
    tab: string;
    /** The visible tabs of `rosterTabs()`. */
    tabs: RosterTab[];
    /** Page actions on the head row. */
    actions?: Snippet;
  }

  let { title, hint, tab, tabs, actions }: Props = $props();
</script>

<PageHead {title} {hint} {actions} />
<PageTabs {tabs} {tab} tabsLabel="Dienstplan" />
