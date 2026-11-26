<script lang="ts">
  // Reusable Segmented Control primitive (Phase 260523-0qf, F-12/F-13).
  // Replaces ad-hoc radiogroup pill trios in AvailabilityWeekGrid and
  // AvailabilityEditModal. Uses radiogroup semantics with full keyboard nav.

  interface Option {
    value: string;
    label: string;
    glyph?: string;
    ariaLabel?: string;
  }

  interface Props {
    options: Option[];
    value?: string;
    name?: string;
    ariaLabel?: string;
    size?: "sm" | "md";
    /**
     * Additive (#991): equal-width segments in one grid row, as wide as the container. A label that
     * does not fit its segment wraps inside it instead of pushing one option onto a row of its own.
     */
    fill?: boolean;
    /**
     * Additive (#992 N-21): `false` keeps all options in ONE row that scrolls sideways inside its
     * container instead of wrapping onto a further row (#945). The default `true` is unchanged.
     */
    wrap?: boolean;
    disabled?: boolean;
    onchange?: (value: string) => void;
  }

  let {
    options,
    value = $bindable(""),
    name = "segmented-control",
    ariaLabel,
    size = "md",
    fill = false,
    wrap = true,
    disabled = false,
    onchange,
  }: Props = $props();

  function select(v: string) {
    if (disabled) return;
    value = v;
    onchange?.(v);
  }

  function handleKeydown(e: KeyboardEvent, idx: number) {
    if (disabled) return;
    let next: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      next = (idx + 1) % options.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      next = (idx - 1 + options.length) % options.length;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = options.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    select(options[next].value);
    // Focus the newly selected button
    const wrapper = (e.currentTarget as HTMLElement).closest('[role="radiogroup"]');
    const btns = wrapper?.querySelectorAll<HTMLButtonElement>("[role=radio]");
    btns?.[next]?.focus();
  }
</script>

<div
  class="seg-control seg-control--{size}"
  class:seg-control--disabled={disabled}
  class:seg-control--fill={fill}
  class:seg-control--nowrap={!wrap}
  style:--seg-count={fill ? options.length : undefined}
  role="radiogroup"
  aria-label={ariaLabel ?? name}
>
  {#each options as opt, idx (opt.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === opt.value}
      aria-label={opt.ariaLabel ?? opt.label}
      class="seg-btn"
      {disabled}
      tabindex={value === opt.value ? 0 : -1}
      onclick={() => select(opt.value)}
      onkeydown={(e) => handleKeydown(e, idx)}
    >
      {#if opt.glyph}
        <span class="seg-glyph" aria-hidden="true">{opt.glyph}</span>
      {/if}
      {opt.label}
    </button>
  {/each}
</div>

<style>
  /* Issue #843 (D-843-01 block 7 "Segment"): pill track on --sunk, the selected option lifts onto
     --card. The track owns the control height; the buttons fill it. */
  /* #945: options that do not fit their container wrap onto a further row instead of being cut off or
     scrolled. The track's radius is half a row's height, so one row is the pill and a wrapped track keeps
     rounded corners without clipping its options. */
  .seg-control {
    --seg-radius: calc(var(--h-control) / 2 + 3px);
    display: inline-flex;
    flex-wrap: wrap;
    align-items: stretch;
    box-sizing: border-box;
    max-width: 100%;
    padding: 2px;
    gap: 0;
    background: var(--sunk);
    border: 1px solid var(--line);
    border-radius: var(--seg-radius);
  }

  /* #992 (N-21): one row, the container scrolls it when it is wider than the screen. */
  .seg-control--nowrap {
    flex-wrap: nowrap;
    max-width: none;
  }
  .seg-control--nowrap .seg-btn {
    flex: 0 0 auto;
    white-space: nowrap;
  }

  .seg-control--md {
    min-height: var(--h-control);
  }

  .seg-control--sm {
    --seg-radius: calc(var(--h-control-sm) / 2 + 3px);
    min-height: var(--h-control-sm);
  }

  /* #991: equal-width segments. The track is a grid of one row; a long label wraps inside its
     segment, so the control is as wide as its container and never grows a second row of segments. */
  .seg-control--fill {
    display: grid;
    grid-template-columns: repeat(var(--seg-count, 1), minmax(0, 1fr));
    width: 100%;
    --seg-radius: var(--r-card);
  }

  .seg-control--fill .seg-btn {
    white-space: normal;
    text-align: center;
    padding-block: 6px;
    padding-inline: 6px;
    line-height: 1.2;
    min-width: 0;
    /* glyph above the label, so a word is never split to make room for it */
    flex-direction: column;
    gap: 2px;
  }

  .seg-control--fill .seg-glyph {
    margin-right: 0;
  }

  .seg-control--disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .seg-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--text-2);
    border: 0;
    border-radius: var(--r-pill);
    font-family: inherit;
    font-weight: 500;
    cursor: pointer;
    transition:
      background 120ms,
      color 120ms;
    white-space: nowrap;
  }

  .seg-control--sm .seg-btn {
    padding: 0 12px;
    font-size: var(--fs-sm);
  }

  .seg-control--md .seg-btn {
    padding: 0 16px;
    font-size: var(--fs-base);
  }

  .seg-btn[aria-checked="true"] {
    background: var(--card);
    color: var(--text);
    box-shadow: var(--shadow);
    font-weight: 600;
  }

  .seg-btn:not([aria-checked="true"]):hover {
    color: var(--text);
  }

  .seg-btn:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  .seg-glyph {
    margin-right: 4px;
    font-style: normal;
  }

  /* WCAG 2.5.5 - 44px min hit target on touch devices */
  @media (pointer: coarse) {
    .seg-control {
      --seg-radius: 25px;
    }
    .seg-btn {
      min-height: 44px;
    }
  }
</style>
