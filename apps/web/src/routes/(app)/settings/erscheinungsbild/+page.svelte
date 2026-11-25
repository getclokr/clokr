<!--
  Ich › Profil › Erscheinungsbild (Issue #854 D-854-03, moved from Verwalten › System by #951): the colour world, the mode and the language of
  the app, rebuilt on the blocks of #843. The choice is a PERSONAL preference: it is saved for the signed-in
  account through the preference stores (`PUT /me/preferences`). The tenant can set a Standard-Farbwelt (Issue
  #976, Verwalten › System › Allgemein) that everyone without an own choice sees; the last card returns to it.
  The Farbwelt that is shown comes from the server's answer. Three `.settings-group`s, no SaveBar: a theme or mode click is a presentation choice that saves at once
  (docs/ADMIN_STRUCTURE.md §3.2.1).
-->
<script lang="ts">
  import { pageLabel } from "$lib/nav/page-labels";
  import { theme, themes, themeChoice, tenantDefaultTheme, type Theme } from "$stores/theme";
  import { mode, type Mode } from "$stores/mode";
  import {
    APPEARANCE_SAVE_ERROR,
    MODE_OPTIONS,
    THEME_DEFAULT_VALUE,
    THEME_OPTIONS,
  } from "$lib/settings/appearance-options";
  import { toasts } from "$stores/toast";
  import { applyPreferences } from "$stores/apply-preferences";
  import PageHead from "$lib/components/layout/PageHead.svelte";
  import Chip from "$components/ui/Chip.svelte";
  import InfoHint, { hintLabel } from "$components/ui/InfoHint.svelte"; // Issue #1058
  import SegmentedControl from "$components/ui/SegmentedControl.svelte";

  // #842 D-842-22: three themes, each previewed in light and dark. The previews are elements that
  // carry data-theme + data-mode themselves, so the real token blocks of tokens.css resolve on
  // them; the page holds no colour of its own.
  const previewModes: { id: Mode; label: string }[] = [
    { id: "light", label: "Hell" },
    { id: "dark", label: "Dunkel" },
  ];

  const modeOptions = MODE_OPTIONS;

  /** Cards: the three themes, then the way back to the Standard des Unternehmens (a card without own choice). */
  const cardLabel = new Map(THEME_OPTIONS.map((o) => [o.value, o.label]));
  const defaultCardLabel = cardLabel.get(THEME_DEFAULT_VALUE) ?? "";

  /** Active card: the own choice; while it is not loaded, the applied theme. */
  function themeActive(id: Theme, choice: Theme | null | undefined, applied: Theme): boolean {
    return choice === undefined ? applied === id : choice === id;
  }

  function fail() {
    toasts.error(APPEARANCE_SAVE_ERROR);
  }

  /** Theme click: one PUT through applyPreferences (Issue #392 rationale); null = the tenant default. */
  function selectTheme(id: Theme | null) {
    applyPreferences({ theme: id }).catch(fail);
  }

  function selectMode(value: string) {
    const next = MODE_OPTIONS.find((o) => o.value === value)?.value;
    if (next) mode.set(next);
  }
</script>

<svelte:head>
  <title>{pageLabel("/settings/erscheinungsbild")} – Clokr</title>
</svelte:head>

<PageHead
  title={pageLabel("/settings/erscheinungsbild")}
  hint="Dein Erscheinungsbild: Es wird für dein Konto gespeichert und gilt auf all deinen Geräten."
/>

<section
  class="settings-group"
  aria-labelledby="themes-farbwelt-title"
  aria-describedby="themes-farbwelt-hint"
>
  <div class="hint-row">
    <h2 class="settings-group-title" id="themes-farbwelt-title">Farbwelt</h2>
    <InfoHint
      text="Wähle die Farbwelt, jeweils in Hell und Dunkel gezeigt."
      label={hintLabel("Farbwelt")}
      textId="themes-farbwelt-hint"
    />
  </div>
  <div class="theme-grid" role="group" aria-label="Farbwelt auswählen">
    {#each themes as t (t.id)}
      {@const active = themeActive(t.id, $themeChoice, $theme)}
      <button
        type="button"
        class="theme-card"
        class:active
        aria-pressed={active}
        onclick={() => selectTheme(t.id)}
      >
        <div class="theme-previews">
          {#each previewModes as m (m.id)}
            <div class="theme-preview" data-theme={t.id} data-mode={m.id}>
              <div class="tp-bar"></div>
              <div class="tp-card">
                <span class="tp-brand"></span>
                <span class="tp-text"></span>
              </div>
              <span class="tp-caption">{m.label}</span>
            </div>
          {/each}
        </div>
        <div class="theme-body">
          <span class="theme-label">{t.label}</span>
          {#if active}
            <Chip tone="brand">Aktiv</Chip>
          {/if}
        </div>
      </button>
    {/each}
    <button
      type="button"
      class="theme-card"
      class:active={$themeChoice === null}
      aria-pressed={$themeChoice === null}
      onclick={() => selectTheme(null)}
    >
      {#if $tenantDefaultTheme}
        <div class="theme-previews">
          {#each previewModes as m (m.id)}
            <div class="theme-preview" data-theme={$tenantDefaultTheme} data-mode={m.id}>
              <div class="tp-bar"></div>
              <div class="tp-card">
                <span class="tp-brand"></span>
                <span class="tp-text"></span>
              </div>
              <span class="tp-caption">{m.label}</span>
            </div>
          {/each}
        </div>
      {/if}
      <div class="theme-body">
        <span class="theme-label">{defaultCardLabel}</span>
        {#if $themeChoice === null}
          <Chip tone="brand">Aktiv</Chip>
        {/if}
      </div>
    </button>
  </div>
</section>

<section
  class="settings-group"
  aria-labelledby="themes-modus-title"
  aria-describedby="themes-modus-hint"
>
  <div class="hint-row">
    <h2 class="settings-group-title" id="themes-modus-title">Modus</h2>
    <InfoHint
      text="Hell, dunkel oder wie dein Gerät, unabhängig von der Farbwelt."
      label={hintLabel("Modus")}
      textId="themes-modus-hint"
    />
  </div>
  <!-- A block wrapper keeps the control as wide as its options (the group stretches its children). -->
  <div>
    <SegmentedControl
      options={modeOptions}
      value={$mode}
      name="mode"
      ariaLabel="Modus auswählen"
      onchange={selectMode}
    />
  </div>
</section>

<style>
  .theme-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--s-4);
  }
  @media (min-width: 1100px) {
    .theme-grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }
  @media (max-width: 720px) {
    .theme-grid {
      grid-template-columns: 1fr;
    }
  }
  .theme-card {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--r-card);
    padding: var(--s-3);
    cursor: pointer;
    text-align: left;
    color: var(--text);
    font-family: var(--font-ui);
    transition:
      transform 160ms var(--ease-out),
      border-color 160ms var(--ease-out);
  }
  .theme-card:hover {
    transform: translateY(-1px);
  }
  .theme-card:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }
  .theme-card.active {
    border-color: var(--brand);
  }

  .theme-previews {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s-2);
  }

  /* Each preview resolves the real token blocks through its own data-theme + data-mode. */
  .theme-preview {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--r-control);
    padding: var(--s-2);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .tp-bar {
    height: 6px;
    width: 40%;
    border-radius: var(--r-pill);
    background: var(--text-3);
  }
  .tp-card {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--r-control);
    padding: var(--s-2);
  }
  .tp-brand {
    flex: none;
    width: 14px;
    height: 14px;
    border-radius: var(--r-pill);
    background: var(--brand);
  }
  .tp-text {
    flex: 1;
    height: 6px;
    border-radius: var(--r-pill);
    background: var(--text-3);
  }
  .tp-caption {
    font-size: 11px;
    font-weight: 600;
    color: var(--text);
  }

  .theme-body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-3) var(--s-1) var(--s-1);
  }
  .theme-label {
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
  }
</style>
