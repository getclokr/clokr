import { expect, type Page } from "@playwright/test";

/**
 * Issue #991 N-13: on Ich > Zeiten a day with ONE closed entry has no footer „Bearbeiten“ in the day
 * panel any more - the row menu „…“ is the one edit path. An empty day keeps „Zeit nachtragen“
 * (`day-sheet-primary`).
 *
 * Opens the add form of an empty chosen day or the edit form of the chosen day's first entry, so a
 * spec that must work in either state does not depend on which one it finds.
 */
export async function openEntryFormOfChosenDay(page: Page): Promise<void> {
  const panel = page.getByTestId("time-entries-day-detail");
  await expect(panel).toBeVisible();
  const primary = page.getByTestId("day-sheet-primary");
  if ((await primary.count()) > 0) {
    await primary.click();
    return;
  }
  await panel.locator("[data-testid^='day-panel-entry-'][data-testid$='-menu']").first().click();
  await page.locator("[data-testid^='day-panel-entry-'][data-testid$='-edit']").first().click();
}
