<!--
  ThemeDefaultSection - „Standard-Farbwelt“ of System › Allgemein (Issue #976): the Farbwelt every person of the
  Unternehmen sees who has no own choice in the profile. It is ONE atomic value, so it saves the moment it is
  changed (docs/ADMIN_STRUCTURE.md §3.2.1, the same decision as the two-factor switch) and has no SaveBar:
  registry section `allgemein-farbwelt`, key `defaultUiTheme`, `PUT /settings/work`. The API audits the change
  with the old and the new value (#285) and refuses a caller without tenant-settings:update. A failed save puts
  the previous value back and says so in the section. After a save the own preferences are fetched again, so the
  look of an admin without an own choice follows at once; light or dark stays everyone's own choice.

  Props:
    config  - the loaded `GET /settings/work` answer (only `defaultUiTheme` is read)
    canEdit - presentation only; the server's 403 stays the authority
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { api } from "$api/client";
  import { toasts } from "$stores/toast";
  import { normalizeTheme, themes, type Theme } from "$stores/theme";
  import { refreshPreferences } from "$stores/apply-preferences";
  import Note from "$components/ui/Note.svelte";
  import SegmentedControl from "$components/ui/SegmentedControl.svelte";
  import type { ThemeDefaultConfig } from "$lib/settings/allgemein";

  interface Props {
    config: ThemeDefaultConfig;
    canEdit?: boolean;
  }

  let { config, canEdit = true }: Props = $props();

  const options = themes.map((t) => ({ value: t.id as string, label: t.label }));

  // Read once (#878): the control owns its value from here on, a later config prop never overwrites it.
  let value = $state<Theme>(untrack(() => normalizeTheme(config.defaultUiTheme)));
  let saving = $state(false);
  let error = $state("");

  const uid = $props.id();
  const titleId = `${uid}-title`;

  async function save(next: string) {
    const previous = value;
    const target = normalizeTheme(next);
    if (target === previous || saving) return;
    value = target;
    saving = true;
    error = "";
    try {
      await api.put("/settings/work", { defaultUiTheme: target });
      toasts.success("Einstellung gespeichert.");
      // The own look follows when the person has no own choice; a failure here never undoes the save.
      void refreshPreferences().catch(() => {});
    } catch (e: unknown) {
      value = previous;
      error = e instanceof Error ? e.message : "Speichern fehlgeschlagen.";
    } finally {
      saving = false;
    }
  }
</script>

<section
  class="settings-group"
  id="standard-farbwelt"
  aria-labelledby={titleId}
  data-testid="admin-system-standard-farbwelt"
>
  <h2 class="settings-group-title" id={titleId}>Standard-Farbwelt</h2>
  <p class="settings-group-desc">
    Diese Farbwelt sehen alle in deinem Unternehmen, die im Profil keine eigene gewählt haben. Hell
    oder dunkel wählt jede Person selbst.
  </p>
  {#if error}
    <div role="alert"><Note tone="bad">{error}</Note></div>
  {/if}
  <!-- A block wrapper keeps the control as wide as its options (the group stretches its children). -->
  <div>
    <SegmentedControl
      {options}
      {value}
      name="standard-farbwelt"
      ariaLabel="Standard-Farbwelt auswählen"
      disabled={!canEdit || saving}
      onchange={save}
    />
  </div>
</section>
