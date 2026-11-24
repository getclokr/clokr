<script module lang="ts">
  // Issue #843 (D-843-04) - demo of block 8. `entries` are relative to apps/web/src/lib.
  export const block = {
    id: 8,
    name: "Chips & Hinweise",
    entries: [
      "components/ui/Chip.svelte",
      "components/ui/Note.svelte",
      "components/ui/InfoHint.svelte",
    ],
  };
</script>

<script lang="ts">
  import Chip from "$components/ui/Chip.svelte";
  import Note from "$components/ui/Note.svelte";
  import InfoHint, { hintLabel } from "$components/ui/InfoHint.svelte";
</script>

<div data-block="8" class="chip-note-demo">
  <div class="chips">
    <Chip tone="ok">Genehmigt</Chip>
    <Chip tone="warn">Offen</Chip>
    <Chip tone="bad">Abgelehnt</Chip>
    <Chip tone="info">Info</Chip>
    <Chip tone="brand">Neu</Chip>
    <Chip tone="neutral">Entwurf</Chip>
  </div>
  <Note tone="ok">Dein Antrag wurde genehmigt.</Note>
  <Note tone="warn">Für diesen Tag fehlt noch eine Pause.</Note>
  <Note tone="bad">Der Monat ist abgeschlossen und nicht mehr änderbar.</Note>
  <Note tone="info">Die Änderung gilt ab dem nächsten Monatsersten.</Note>
  <div class="hints">
    <span>Urlaubsanspruch</span>
    <InfoHint
      text="Der Anspruch gilt je Kalenderjahr und wird beim Jahreswechsel neu berechnet."
      label={hintLabel("Urlaubsanspruch")}
    />
    <span>Pause</span>
    <InfoHint tone="warn" text="Für diesen Tag fehlt noch eine Pause." label={hintLabel("Pause")} />
  </div>
</div>

<style>
  .chip-note-demo {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .hints {
    display: flex;
    align-items: center;
    gap: var(--s-1);
  }
  .hints span:nth-of-type(2) {
    margin-left: var(--s-4);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
</style>
