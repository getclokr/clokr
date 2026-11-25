<script lang="ts">
  // Issue #851 (D-851-02): the personal appearance in the profile - Farbwelt and Modus. The same stores and
  // the same single PUT /me/preferences as the Erscheinungsbild page (Issue #392 rationale in apply-preferences.ts);
  // a personal preference every person may set, so no permission is involved.
  // Issue #975: the Modus control also offers following the device. Issue #976: the Farbwelt control also
  // offers the way back to the Standard-Farbwelt of the Unternehmen; the Farbwelt that is shown comes from
  // the server's answer, never from this component.
  import Section from "$lib/components/admin/Section.svelte";
  import SegmentedControl from "$components/ui/SegmentedControl.svelte";
  import { theme, themeChoice, tenantDefaultTheme } from "$stores/theme";
  import { mode } from "$stores/mode";
  import { applyPreferences } from "$stores/apply-preferences";
  import { toasts } from "$stores/toast";
  import {
    APPEARANCE_SAVE_ERROR,
    MODE_OPTIONS,
    THEME_OPTIONS,
    tenantDefaultHint,
    themeControlValue,
    themeFromControlValue,
  } from "$lib/settings/appearance-options";

  const themeValue = $derived(themeControlValue($themeChoice, $theme));
  const hint = $derived(tenantDefaultHint($tenantDefaultTheme));

  function fail() {
    toasts.error(APPEARANCE_SAVE_ERROR);
  }

  function selectTheme(value: string) {
    const next = themeFromControlValue(value);
    if (next === undefined) return;
    applyPreferences({ theme: next }).catch(fail);
  }

  function selectMode(value: string) {
    const next = MODE_OPTIONS.find((o) => o.value === value)?.value;
    if (next) applyPreferences({ mode: next }).catch(fail);
  }
</script>

<Section title="Darstellung" sub="Gilt für dein Konto auf all deinen Geräten.">
  <div class="appearance-rows">
    <div class="appearance-row">
      <span class="appearance-label" id="appearance-theme">Farbwelt</span>
      <SegmentedControl
        options={THEME_OPTIONS}
        value={themeValue}
        name="profile-theme"
        ariaLabel="Farbwelt auswählen"
        size="sm"
        onchange={selectTheme}
      />
    </div>
    {#if hint}
      <p class="appearance-hint" data-testid="appearance-default-hint">{hint}</p>
    {/if}
    <div class="appearance-row">
      <span class="appearance-label" id="appearance-mode">Modus</span>
      <SegmentedControl
        options={MODE_OPTIONS}
        value={$mode}
        name="profile-mode"
        ariaLabel="Modus auswählen"
        size="sm"
        onchange={selectMode}
      />
    </div>
    <p class="appearance-more">
      <a href="/ich/profil/erscheinungsbild">Vorschau der Farbwelten und Sprache</a>
    </p>
  </div>
</Section>

<style>
  .appearance-more {
    margin: 0;
    font-size: var(--fs-sm);
  }

  .appearance-hint {
    margin: calc(-1 * var(--s-1)) 0 0;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }

  .appearance-rows {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }

  .appearance-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    flex-wrap: wrap;
  }

  .appearance-label {
    font-weight: 500;
    color: var(--text);
  }
</style>
