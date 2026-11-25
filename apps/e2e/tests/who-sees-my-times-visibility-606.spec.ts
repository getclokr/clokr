/**
 * Issue #606 - Sichtbarkeits-Durchlauf (Issue #710) for „Warum stempeln?“ and „Wer sieht meine Zeiten?“.
 *
 * What the person has to SEE must lie in the viewport after the step, at 1280, 390 and 360 px, light
 * and dark:
 *   (a) Mein Tag: a new person (the fresh tenant admin has not closed the intro) sees the card; after
 *       „Verstanden“ the success toast and the next heading („Deine Woche“) are in view.
 *   (b) Ich > Profil: with a Salonmanager assigned in the tenant the section lists the „Salonmanager“
 *       row; „„Warum stempeln?“ ansehen“ opens the intro in a dialog whose title and „Schließen“ are in
 *       view.
 * Tenant fixture only: synthetic `.test`/`.invalid` addresses and invented names, no date dependency,
 * no sleeps.
 */
import { expect } from "../fixtures";
import { defineVisibilityWalkthrough } from "../helpers/visibility-walkthrough";
import { createHomedPerson, listSalons, ROLE_TEMPLATE } from "../helpers/team-seed";

defineVisibilityWalkthrough({
  title: "Warum stempeln auf Mein Tag",
  path: "/ich/tag",
  ready: async (page) => {
    await expect(page.getByRole("heading", { name: "Warum stempeln?" })).toBeVisible();
  },
  steps: [
    {
      name: "Verstanden",
      act: async (page) => {
        await page.getByRole("button", { name: "Verstanden" }).click();
        await expect(page.getByTestId("why-clock-intro")).toHaveCount(0);
      },
      target: (page) => [
        page
          .getByTestId("toast-region-status")
          .getByText("Ausgeblendet. „Warum stempeln?“ findest du jederzeit im Profil."),
        page.getByRole("heading", { name: /Deine Woche/ }),
      ],
    },
  ],
});

defineVisibilityWalkthrough({
  title: "Wer sieht meine Zeiten im Profil",
  path: "/ich/profil",
  seed: async ({ request, tenant }) => {
    const salons = await listSalons(request, tenant);
    // A Salonmanager over every salon of the tenant reads the admin's times whatever the admin's
    // Stammsalon is (as the Stammsalon's or an entry salon's reader).
    await createHomedPerson(request, tenant, {
      key: "sm606",
      firstName: "Selma",
      lastName: "Leitung",
      homeSalonId: salons[0].id,
      password: "Passw0rd!606",
      template: {
        id: ROLE_TEMPLATE.SALON_MANAGER,
        scope: { type: "SALONS", salonIds: salons.map((s) => s.id) },
      },
    });
  },
  ready: async (page) => {
    // The Section title is a styled div, not a heading: name it inside the section's anchor.
    await expect(
      page.locator("#wer-sieht-meine-zeiten").getByText("Wer sieht meine Zeiten?", { exact: true }),
    ).toBeVisible();
  },
  steps: [
    {
      name: "Abschnitt öffnen",
      act: async (page) => {
        const list = page.getByTestId("time-entry-readers");
        await expect(list).toBeVisible();
        await list.scrollIntoViewIfNeeded();
      },
      target: (page) => page.getByTestId("time-entry-readers").getByText("Salonmanager"),
    },
    {
      name: "Warum stempeln ansehen",
      act: async (page) => {
        await page.getByRole("button", { name: "„Warum stempeln?“ ansehen" }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
      },
      target: (page) => [
        page.getByRole("dialog").getByRole("heading", { name: "Warum stempeln?" }),
        page.getByRole("dialog").getByRole("button", { name: "Schließen" }),
      ],
    },
  ],
});
