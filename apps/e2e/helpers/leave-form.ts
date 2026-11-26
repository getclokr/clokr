import type { Locator, Page } from "@playwright/test";

/**
 * Issue #991 N-15 / M-35: the buttons of the absence dialog live in the Dialog footer (`.modal-foot`),
 * so the submit stays in view while the body scrolls. They are NOT inside `[data-testid="leave-form"]`
 * any more; the test ids are unchanged. A spec reaches them through these two helpers, so the next
 * move of a button is a one-file change.
 */
export function leaveFormSubmit(page: Page): Locator {
  return page.locator(".modal-foot").getByTestId("leave-form-submit");
}

export function leaveFormCancel(page: Page): Locator {
  return page.locator(".modal-foot").getByTestId("leave-form-cancel");
}
