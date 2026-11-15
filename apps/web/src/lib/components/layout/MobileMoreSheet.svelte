<script lang="ts">
  import { focusTrap } from "$lib/utils/focus-trap";
  import Icon from "$lib/components/Icon.svelte";
  import { versionStore, loadVersion } from "$stores/version";
  import {
    hasUnreadReleaseNotes,
    loadReleaseNotesData,
    openWhatsNew,
    whatsNewEntryLabel,
  } from "$stores/release-notes";
  import { onMount } from "svelte";
  import { activeNavHref } from "$lib/nav/active-route";
  import { navCurrentPath } from "$lib/nav/routes";

  import type { NavSection } from "$lib/nav/app-nav";

  interface Props {
    /** Two-way bindable open state. Parent holds the flag. */
    open: boolean;
    /** The permission-filtered sections, the same ones the desktop Sidebar renders (#516). */
    sections: NavSection[];
    /** Used to mark the active item with brand-soft highlight. */
    currentPath: string;
  }

  let { open = $bindable(), sections, currentPath }: Props = $props();

  // Phase 69 (DEVOPS-V8-02): mobile runtime version display.
  // Subscribes to the shared $versionStore (hydrated by loadVersion()) so
  // Sidebar + MobileMoreSheet stay in sync and only one network call is made.
  // Fail-silent (D-08) — no toast, no console.error.
  onMount(() => {
    loadVersion();
    // Phase 110 (D-07/D-09): the unread marker must be able to render as soon as the shell does,
    // so the notes and the seen state are hydrated here alongside the version. Both loaders are
    // single-shot and fail-silent, so calling this from two components costs one request total.
    loadReleaseNotesData();
  });

  let scrimEl: HTMLDivElement | undefined = $state();

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      open = false;
    }
  }

  function onScrimClick(e: MouseEvent) {
    // Only close when the click landed on the scrim itself, never a child.
    if (e.target === e.currentTarget) open = false;
  }

  function onItemClick() {
    // Navigation occurs through <a href> — close the sheet so the page
    // transition happens against a clean shell.
    open = false;
  }

  // Shared rule ($lib/nav/active-route): the same item is current here as in the tab bar.
  const currentHref = $derived(
    activeNavHref(
      sections.flatMap((section) => section.items.map((item) => item.href)),
      navCurrentPath(currentPath),
    ),
  );

  // Lock body scroll + mark sibling content inert while open.
  // Same pattern as Modal.svelte — see that file for the rationale on why
  // we exclude the scrim's containing element by reference rather than by
  // class name (SvelteKit's display:contents wrapper).
  $effect(() => {
    if (!open || !scrimEl) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const toRestore: Element[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child.contains(scrimEl)) continue;
      if (child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      toRestore.push(child);
    }

    return () => {
      document.body.style.overflow = previousOverflow;
      for (const el of toRestore) el.removeAttribute("inert");
    };
  });
</script>

<svelte:window onkeydown={onKeyDown} />

{#if open}
  <div class="mehr-scrim" role="presentation" onclick={onScrimClick} bind:this={scrimEl}>
    <div
      class="mehr-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Weitere Navigation"
      use:focusTrap
    >
      <header class="mehr-sheet-hd">
        <span class="mehr-sheet-grabber" aria-hidden="true"></span>
        <h3 class="mehr-sheet-title">Mehr</h3>
        <button
          type="button"
          class="mehr-sheet-close"
          aria-label="Schließen"
          onclick={() => (open = false)}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </header>
      <div class="mehr-sheet-body">
        {#each sections as section (section.label)}
          <h4 class="mehr-section-label" translate="no">{section.label}</h4>
          <nav class="mehr-sheet-nav" aria-label={section.label}>
            {#each section.items as item (item.href)}
              {@const active = item.href === currentHref}
              <a
                href={item.href}
                class="mehr-item"
                class:mehr-item-active={active}
                aria-current={active ? "page" : undefined}
                onclick={onItemClick}
              >
                <span class="mehr-item-icon" aria-hidden="true"
                  ><Icon name={item.icon} size={18} /></span
                >
                <span class="mehr-item-label" translate="no">{item.label}</span>
              </a>
            {/each}
          </nav>
        {/each}
        {#if $versionStore}
          <div class="mehr-sheet-version" aria-label="Anwendungsversion">
            <button
              type="button"
              class="mehr-version-btn"
              onclick={openWhatsNew}
              aria-label={whatsNewEntryLabel($versionStore, $hasUnreadReleaseNotes)}
              title="Was ist neu"
              data-testid="mobile-whats-new"
            >
              <span class="mehr-version-label" translate="no">v{$versionStore}</span>
              {#if $hasUnreadReleaseNotes}
                <span class="badge badge-purple mehr-version-badge" aria-hidden="true">Neu</span>
              {/if}
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* ── Mobile More Sheet (UI-15) ────────────────────────────────
     Bottom-sheet variant of the Modal pattern: focus-trap + ESC + scrim-click
     close, body-scroll lock, inert siblings. Slides up from the bottom edge. */
  .mehr-scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 500;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    animation: mehr-fade 180ms var(--ease-out);
  }

  .mehr-sheet {
    width: 100%;
    max-height: 80vh;
    background: var(--card);
    border-top-left-radius: var(--r-card);
    border-top-right-radius: var(--r-card);
    border-top: 1px solid var(--line);
    box-shadow: var(--shadow-pop);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: mehr-slide-up 240ms var(--ease-out);
    padding-bottom: env(safe-area-inset-bottom, 0);
  }

  .mehr-sheet-hd {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px 16px 12px;
    border-bottom: 1px solid var(--line);
  }

  .mehr-sheet-grabber {
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--line-2, var(--line));
  }

  .mehr-sheet-title {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 18px;
    font-weight: 400;
    color: var(--text);
  }

  .mehr-sheet-close {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    width: 44px;
    height: 44px;
    border-radius: var(--r-control);
    border: 1px solid transparent;
    background: transparent;
    display: grid;
    place-items: center;
    color: var(--text-2);
    cursor: pointer;
    transition:
      background 120ms var(--ease),
      color 120ms var(--ease);
  }

  .mehr-sheet-close:hover {
    background: var(--sunk);
    color: var(--text);
  }

  .mehr-sheet-close:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  .mehr-sheet-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0 12px;
  }

  .mehr-sheet-nav {
    display: flex;
    flex-direction: column;
  }

  /* Group heading, same wording and casing as the desktop sidebar's section labels. */
  .mehr-section-label {
    margin: 0;
    padding: var(--s-4) 18px var(--s-1);
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-2);
  }

  .mehr-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 14px;
    /* WCAG 2.5.5 — 48px ≥ 44 minimum for comfort. */
    min-height: 48px;
    padding: 10px 18px;
    color: var(--text);
    text-decoration: none;
    font-family: var(--font-ui);
    font-size: 14.5px;
    font-weight: 500;
    transition:
      background 120ms var(--ease),
      color 120ms var(--ease);
  }

  .mehr-item:hover,
  .mehr-item:focus-visible {
    background: var(--sunk);
  }

  .mehr-item:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: -2px;
  }

  .mehr-item-active {
    background: var(--brand-soft);
    color: var(--brand);
  }

  /* The current page is marked by more than colour (WCAG 1.4.1): a brand bar and a heavier label,
     the same recipe as the desktop sidebar's .nav-item.active::before (Sidebar.svelte) and the
     global .view-tab--active (app.css). The tint above stays; the bar carries the meaning. */
  .mehr-item[aria-current="page"]::before {
    content: "";
    position: absolute;
    left: 0;
    top: 10px;
    bottom: 10px;
    width: 2px;
    background: var(--brand);
    border-radius: 0 1px 1px 0;
  }

  .mehr-item[aria-current="page"] .mehr-item-label {
    font-weight: 600;
  }

  .mehr-item-icon {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    color: var(--text-2);
    flex-shrink: 0;
  }

  .mehr-item-active .mehr-item-icon {
    color: var(--brand);
  }

  /* Semantic hook for the visible label — typography is inherited from
     .mehr-item; this selector exists so lint:ui-classes can match it. */
  .mehr-item-label {
    flex: 1;
    min-width: 0;
  }

  /* Phase 69 — runtime version display in the mobile drawer.
     Mirrors .sidebar-version on desktop. Literal font-size 0.75rem per D-07
     (no --text-xs token exists in tokens.css). */
  .mehr-sheet-version {
    padding: var(--s-3) var(--s-3) var(--s-2);
    border-top: 1px solid var(--line);
    text-align: center;
  }

  /* Phase 110 (D-09): the version line is now the What's-New entry point — reset the
     button chrome so it still reads as plain text, keep a visible focus ring because it
     is now a real interactive control. */
  .mehr-version-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  .mehr-version-btn:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  .mehr-version-label {
    font-size: 0.75rem;
    color: var(--text-3);
    font-feature-settings: "tnum";
    letter-spacing: 0.02em;
  }

  /* Mirrors Topbar.svelte's .notif-dot.unread-dot idiom. */
  .mehr-version-badge {
    font-size: 10px;
    padding: 1px 6px;
  }

  @keyframes mehr-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes mehr-slide-up {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
</style>
