<!-- Issue #844: hub page of the route table entry /verwalten/system (its children are listed by HubPage).
     Issue #951: Farbwelt und Modus are personal now; a calm hint points to the profile. -->
<script lang="ts">
  import HubPage from "$lib/components/layout/HubPage.svelte";
  import Note from "$components/ui/Note.svelte";
  import { pageLabel } from "$lib/nav/page-labels";
</script>

<svelte:head>
  <title>{pageLabel("/verwalten/system")} – Clokr</title>
</svelte:head>

<HubPage
  title={pageLabel("/verwalten/system")}
  hub="/verwalten/system"
  sub="Grundeinstellungen, Schnittstellen und Rollen."
  listTitle="Alle Bereiche"
>
  {#snippet intro()}
    <div data-testid="system-darstellung-hint">
      <Note tone="info"
        >Farbwelt und Modus stellst du jetzt in deinem Profil ein.
        <a href="/ich/profil">Zum Profil</a></Note
      >
    </div>
  {/snippet}
</HubPage>
