// Phase 415 (GitHub issue #415) — the shared shape `LeaveRequestForm.svelte` and its two callers
// (`/leave`, `/team/leave`) agree on for edit mode. Kept in a plain `.ts` module rather than
// exported from the `.svelte` file itself, matching this codebase's existing convention for
// cross-file Svelte prop types (e.g. `leave-review.ts` for `LeaveReviewDialog.svelte`).
import type { CalendarTypeCode } from "./team-calendar-visibility";

/** Non-null `editingRequest` prop of `LeaveRequestForm.svelte` — edit an existing PENDING
 *  request. `null` means create mode. */
export interface EditableLeaveRequest {
  id: string;
  typeCode: CalendarTypeCode;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  note: string | null;
  /** The request's stored price in days (Issue #1109): a PENDING vacation request is already
   *  subtracted from the free days, so the edit dialog gives it back before pricing the new dates. */
  days?: number | string;
}
