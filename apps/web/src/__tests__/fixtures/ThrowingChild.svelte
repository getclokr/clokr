<script lang="ts">
  // Test fixture: throws on demand so the boundary has something to catch.
  // Two throw sites because #115 threw from onMount, not from the template.
  import { onMount } from "svelte";

  interface Props {
    when: "render" | "render-plain" | "mount" | "never";
  }

  let { when }: Props = $props();

  // Read inside a closure: the throw sites run once, while the component renders.
  function throwWhileRendering() {
    if (when === "render") throw new Error("BOOM-127-render");
    // What kit 3's transformError hands every boundary: a plain object, not an Error (#1015).
    if (when === "render-plain") throw { status: 500, message: "Internal Error" };
  }
  throwWhileRendering();

  onMount(() => {
    if (when === "mount") throw new Error("BOOM-127-mount");
  });
</script>

<p data-testid="throwing-child">Kind gerendert</p>
