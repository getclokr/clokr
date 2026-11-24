<script lang="ts">
  // Issue #1011: src/hooks.ts reroutes the Dienstplan tabs /team/dienstplan (Woche), /team/dienstplan/planung
  // (Bedarf) and /team/dienstplan/konflikte (Hinweise) to the files below this directory, which no Team layout
  // wraps. This layout gives them the shared RouteGuard, so a caller without the route-table permission is sent
  // to the start page before the page loads. A UX gate only; the API's 403 stays the authority.
  import RouteGuard from "$lib/components/layout/RouteGuard.svelte";

  interface Props {
    children?: import("svelte").Snippet;
  }

  let { children }: Props = $props();
</script>

<RouteGuard>{@render children?.()}</RouteGuard>
