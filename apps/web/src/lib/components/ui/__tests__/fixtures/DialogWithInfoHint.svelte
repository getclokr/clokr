<script lang="ts">
  // Test fixture: an InfoHint inside an open Dialog, the shape of a form field with an explanation.
  import Dialog from "../../Dialog.svelte";
  import InfoHint, { hintLabel } from "../../InfoHint.svelte";

  let { onOpenChange }: { onOpenChange?: (open: boolean) => void } = $props();
  let open = $state(true);
</script>

<Dialog bind:open title="Abwesenheit" {onOpenChange}>
  <p>Urlaubsanspruch</p>
  <InfoHint text="Der Anspruch gilt je Kalenderjahr." label={hintLabel("Urlaubsanspruch")} />
</Dialog>
