<script module lang="ts">
  // Issue #843 (D-843-04) - demo of block 5. `entries` are relative to apps/web/src/lib.
  export const block = {
    id: 5,
    name: "Liste",
    entries: [
      "components/ui/List.svelte",
      "components/ui/ListRow.svelte",
      "components/ui/ListWidget.svelte",
      "components/ui/Pager.svelte",
    ],
  };
</script>

<script lang="ts">
  import List from "$components/ui/List.svelte";
  import ListRow from "$components/ui/ListRow.svelte";
  import ListWidget from "$components/ui/ListWidget.svelte";
  import Chip from "$components/ui/Chip.svelte";

  // Issue #1028: a list widget with 12 rows, filter chips with the caller's counts and a „mehr“ link. The
  // demo passes no `listId`, so its page size and filter live for the visit and nothing is stored (the
  // example page renders this demo six times).
  interface DemoTask {
    id: number;
    title: string;
    kind: "urlaub" | "nachtrag";
  }

  const TASKS: DemoTask[] = Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    title: `Aufgabe ${i + 1}`,
    kind: i % 3 === 0 ? "nachtrag" : "urlaub",
  }));

  let filter = $state("alle");
  const shown = $derived(filter === "alle" ? TASKS : TASKS.filter((t) => t.kind === filter));
  const chips = $derived([
    { value: "alle", label: "Alle", count: TASKS.length },
    { value: "urlaub", label: "Urlaub", count: TASKS.filter((t) => t.kind === "urlaub").length },
    {
      value: "nachtrag",
      label: "Nachtrag",
      count: TASKS.filter((t) => t.kind === "nachtrag").length,
    },
  ]);
</script>

<div data-block="5">
  <List ariaLabel="Team">
    <ListRow title="Person A" subtitle="Salon Nord">
      {#snippet trailing()}<Chip tone="ok">Genehmigt</Chip>{/snippet}
    </ListRow>
    <ListRow title="Person B" subtitle="Salon Süd">
      {#snippet trailing()}<Chip tone="warn">Offen</Chip>{/snippet}
    </ListRow>
    <ListRow title="Person C" subtitle="Salon Nord">
      {#snippet trailing()}<Chip tone="neutral">Entwurf</Chip>{/snippet}
    </ListRow>
    <ListRow
      variant="task"
      title="Urlaubsantrag 10.11.–14.11.2026"
      subtitle="Person A · Salon Nord"
    >
      {#snippet actions()}
        <button type="button" class="btn btn-secondary btn-sm">Ablehnen</button>
        <button type="button" class="btn btn-primary btn-sm">Genehmigen</button>
      {/snippet}
    </ListRow>
  </List>

  <ListWidget
    title="Aufgaben"
    items={shown}
    itemKey={(t) => String(t.id)}
    filters={chips}
    bind:filter
    moreHref="/team/aufgaben"
    moreLabel="Alle Aufgaben"
  >
    {#snippet row(task)}
      <ListRow title={task.title} subtitle="Person A · Salon Nord" avatar={false} />
    {/snippet}
  </ListWidget>
</div>

<style>
  div[data-block="5"] {
    display: flex;
    flex-direction: column;
    gap: var(--s-6);
  }
</style>
