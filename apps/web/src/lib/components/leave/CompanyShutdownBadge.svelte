<script lang="ts">
  /**
   * CompanyShutdownBadge — Issue #1095. „Betriebsurlaub“ on a leave row that comes from one, with the
   * shutdown's own name beside it. It renders nothing for any other row: the decision is the row's
   * shutdown FIELD (`shutdownMark`), never its type name or any other text.
   */
  import {
    COMPANY_SHUTDOWN_LABEL,
    shutdownMark,
    shutdownTitle,
    type ShutdownFields,
  } from "$lib/leave/company-shutdown";

  interface Props {
    /** The leave row (list item or calendar entry) carrying `companyShutdownId` / `companyShutdown`. */
    row: ShutdownFields;
    testId?: string;
  }

  let { row, testId = "company-shutdown-badge" }: Props = $props();

  const mark = $derived(shutdownMark(row));
</script>

{#if mark}
  <span class="shutdown" data-testid={testId} title={shutdownTitle(mark)}>
    <span class="badge badge-gray">{COMPANY_SHUTDOWN_LABEL}</span>
    {#if mark.name}<span class="shutdown-name" data-testid="{testId}-name">{mark.name}</span>{/if}
  </span>
{/if}

<style>
  .shutdown {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.375rem;
    min-width: 0;
  }

  .shutdown-name {
    font-size: 0.8125rem;
    color: var(--text-2);
    overflow-wrap: anywhere;
  }
</style>
