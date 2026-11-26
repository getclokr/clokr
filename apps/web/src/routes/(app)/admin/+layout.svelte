<script lang="ts">
  // Issue #83 (D-10/D-16): the admin pages are guarded by permission through the one route map
  // (since #844 the shared RouteGuard, also used by the Verwalten and Team layouts).
  import { page } from "$app/state";
  import RouteGuard from "$lib/components/layout/RouteGuard.svelte";

  interface Props {
    children?: import("svelte").Snippet;
  }

  let { children }: Props = $props();

  // Issue #992 (D-992-20): the availability list is the fourth Dienstplan tab. The other three tabs
  // have no wrapper, so this one starts flush too and the head sits at the same height on all four.
  const flush = $derived(page.route.id === "/(app)/admin/availability");
</script>

<RouteGuard>
  <div class="admin-shell">
    <div class="admin-content" class:admin-content--flush={flush}>
      {@render children?.()}
    </div>
  </div>
</RouteGuard>

<style>
  .admin-content {
    padding-top: 0.5rem;
  }

  .admin-content--flush {
    padding-top: 0;
  }

  /* ── Section Headers (Phase 9) — used by admin sub-pages ─────── */
  /* Apply to <h2> inside .card sections: <h2 class="section-header">Title</h2> */
  :global(.section-header) {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text);
    margin: 0 0 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--line);
  }
</style>
