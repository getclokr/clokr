<script lang="ts">
  // Issue #1114 — the route file of Team › Berichte (`/team/berichte` is rerouted to `/reports`) sat under no
  // guard, so a person without report:read and team-overview:read opened it. The shared RouteGuard decides by the
  // route-table permission of the URL and sends a denied person to Ich › Konto (`deniedTo`). A UX gate only; the
  // API's 403 stays the authority.
  import RouteGuard from "$lib/components/layout/RouteGuard.svelte";

  interface Props {
    children?: import("svelte").Snippet;
  }

  let { children }: Props = $props();
</script>

<RouteGuard>{@render children?.()}</RouteGuard>
