import type { HandleClientError } from "@sveltejs/kit/hooks";
import { clientLogger } from "$lib/utils/logger";

// Issue #1015 (Phase 127 D-05 parity) - SvelteKit 3 wraps every route node in a boundary armed with
// the nearest `+error.svelte` and mounts with `transformError`, so a page render error reaches this
// hook first, and clokr's own ErrorBoundary receives only kit's plain `{ status, message }` object
// (it skips those, see `ErrorBoundary.svelte`). This is where an unexpected client error is
// reported to `POST /api/v1/logs/client` exactly once.
//
// Only `kind === "unknown"` (an error thrown by our own code) is reported: a 404 (`framework`) and a
// deliberate `error()` (`app`) were never reported. The hook must never throw, and it returns
// nothing so kit keeps its default status and message.
export const handleError: HandleClientError = ({ error, kind }) => {
  if (kind !== "unknown") return;
  try {
    const err = error instanceof Error ? error : undefined;
    clientLogger.error(`Render-Fehler (kit): ${err?.message ?? String(error)}`, {
      stack: err?.stack,
      boundary: "kit",
    });
  } catch {
    // Reporting is best effort; a failing logger must not turn into a second error.
  }
};
