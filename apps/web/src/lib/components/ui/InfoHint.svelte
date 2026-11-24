<script lang="ts" module>
  /** Delay before a hover opens (and closes) the panel; keyboard focus and tap open at once. */
  export const HINT_HOVER_DELAY_MS = 150;

  /** The accessible name of an InfoHint trigger for the heading, label or value it explains. */
  export function hintLabel(subject: string): string {
    return `Erklärung zu „${subject}“`;
  }
</script>

<script lang="ts">
  // Issue #1058 (sub-part of block 8 „Chips & Hinweise“) - the ONE info symbol. A pure explanation
  // (what a setting means, how a figure is built) takes no room: it sits behind a small symbol
  // beside the heading, label or value it explains. A deadline, lock, warning, error, legal
  // consequence, the effect of a button about to be pressed or a state the person must act on stays
  // visible text; this block is not for those (README, „Hinweise als Info-Symbol“).
  //
  // Popover, not Tooltip (P-01): the bits-ui Tooltip trigger ignores touch and closes on every
  // pointerdown, so a tap could never open it. The Popover trigger toggles on click/tap and
  // Enter/Space, opens on hover with a delay, and its content layer closes on Escape and on an
  // outside press. Opening on KEYBOARD focus is added here: a pointerdown flag tells keyboard focus
  // from the focus that a mouse press or a tap causes (that one is opened by the click instead).
  //
  // A11y: the trigger is a real button named by `label`; its aria-describedby points at a visually
  // hidden text that is in the DOM from the start, so a screen reader announces the explanation as
  // soon as the trigger gets focus, with the panel open or not. The panel itself is aria-hidden (it
  // repeats that text). Plain text only: a link or button inside would be unreachable.
  import { Popover } from "bits-ui";
  import Icon from "$components/Icon.svelte";

  interface Props {
    /** The explanation; plain text. An array is joined with spaces for the screen reader and shown as one paragraph per entry. */
    text: string | string[];
    /** Accessible name of the trigger; `hintLabel(<heading or label>)`. */
    label: string;
    /** "warn" renders the solid warn disc with „!“ (the ArbZG mark of the Zeiten list). */
    tone?: "info" | "warn";
    /** Id of the always-present text element, for a carrier that lists it in aria-describedby. */
    textId?: string;
    /** `data-testid` of the always-present text element. */
    testId?: string;
    /** `data-testid` of the trigger; `<testId>-trigger` when `testId` is set. */
    triggerTestId?: string;
    /** Icon size in px. */
    size?: number;
  }

  let { text, label, tone = "info", textId, testId, triggerTestId, size = 16 }: Props = $props();

  const uid = $props.id();
  const resolvedTextId = $derived(textId ?? `${uid}-text`);
  const resolvedTriggerTestId = $derived(
    triggerTestId ?? (testId ? `${testId}-trigger` : undefined),
  );
  const lines = $derived(Array.isArray(text) ? text : [text]);

  let open = $state(false);
  // Not reactive on purpose: it only separates the focus a pointer press causes from keyboard focus.
  let pointerFocus = false;
  let contentEl: HTMLElement | null = $state(null);

  function onpointerdown() {
    pointerFocus = true;
  }

  function onfocus() {
    if (pointerFocus) {
      pointerFocus = false;
      return;
    }
    open = true;
  }

  function onblur(event: FocusEvent) {
    pointerFocus = false;
    const next = event.relatedTarget;
    if (next instanceof Node && contentEl?.contains(next)) return;
    open = false;
  }
</script>

<span class="info-hint">
  <Popover.Root bind:open>
    <Popover.Trigger
      openOnHover
      openDelay={HINT_HOVER_DELAY_MS}
      closeDelay={HINT_HOVER_DELAY_MS}
      {onpointerdown}
      {onfocus}
      {onblur}
    >
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          class="ih-trigger"
          data-tone={tone}
          data-testid={resolvedTriggerTestId}
          aria-label={label}
          aria-describedby={resolvedTextId}
          aria-haspopup={undefined}
        >
          {#if tone === "warn"}
            <span class="ih-mark" aria-hidden="true">!</span>
          {:else}
            <Icon name="info" {size} />
          {/if}
        </button>
      {/snippet}
    </Popover.Trigger>
    <span class="sr-only" id={resolvedTextId} data-testid={testId}>{lines.join(" ")}</span>
    <Popover.Portal>
      <Popover.Content
        side="bottom"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        trapFocus={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {#snippet child({ props, wrapperProps, open: isOpen })}
          {#if isOpen}
            <div {...wrapperProps}>
              <div {...props} class="ih-pop" aria-hidden="true" bind:this={contentEl}>
                {#each lines as line, i (i)}
                  <p>{line}</p>
                {/each}
              </div>
            </div>
          {/if}
        {/snippet}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
</span>

<style>
  .info-hint {
    display: inline-flex;
    align-items: center;
    flex: none;
  }

  /* 24 x 24 px hit area (WCAG 2.5.8) that takes no more line height than the text beside it, so a
     field with a hint lines up with its neighbour. */
  .ih-trigger {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    margin: -4px 0;
    padding: 0;
    border: 0;
    border-radius: var(--r-pill);
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
  }

  .ih-trigger:hover,
  .ih-trigger[data-state="open"] {
    color: var(--text);
  }

  /* The solid warn disc of the ArbZG list mark; the „!“ is decoration, the sentence is the text. */
  .ih-mark {
    display: inline-grid;
    place-items: center;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: var(--warn);
    color: var(--card);
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
  }

  /* bits-ui copies the COMPUTED z-index of the content onto the floating wrapper (inline style), so
     the stacking value has to sit on the content itself or the panel renders under a Dialog
     (1500/1501) it was opened from (the Combobox lesson, Issue #853). */
  .ih-pop {
    z-index: 1600;
    box-sizing: border-box;
    max-width: min(320px, calc(100vw - 16px));
    padding: var(--s-3) var(--s-4);
    border: 1px solid var(--line);
    border-radius: var(--r-control);
    background: var(--card);
    color: var(--text);
    box-shadow: var(--shadow-pop);
    font-size: var(--fs-sm);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .ih-pop p {
    margin: 0;
  }

  .ih-pop p + p {
    margin-top: var(--s-2);
  }
</style>
