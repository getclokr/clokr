// Issue #604 - the tenant switch „Abgleich mit Terminen“ in Verwalten › Regeln › Arbeitszeit & Verträge:
// its registry section, its tab, how it reads the stored value and what its save puts on the wire.
import { describe, expect, it } from "vitest";

import { appointmentHintsFrom, appointmentHintsWire } from "$lib/settings/arbeitszeit";
import { ARBEITSZEIT_TAB_ALIASES, ARBEITSZEIT_TABS } from "$lib/settings/arbeitszeit-tabs";
import { mayOpenSection, settingsSection } from "$lib/settings/settings-pages";

describe("the switch of the appointment comparison (Issue #604)", () => {
  it("reads an absent or non-true field as OFF - the default of every tenant", () => {
    expect(appointmentHintsFrom({})).toEqual({ appointmentTimeHintsEnabled: false });
    expect(appointmentHintsFrom({ appointmentTimeHintsEnabled: false })).toEqual({
      appointmentTimeHintsEnabled: false,
    });
    expect(appointmentHintsFrom({ appointmentTimeHintsEnabled: true })).toEqual({
      appointmentTimeHintsEnabled: true,
    });
  });

  it("puts a boolean and nothing else on the wire", () => {
    expect(appointmentHintsWire({ appointmentTimeHintsEnabled: true })).toEqual({
      appointmentTimeHintsEnabled: true,
    });
    expect(appointmentHintsWire({ appointmentTimeHintsEnabled: false })).toEqual({
      appointmentTimeHintsEnabled: false,
    });
  });

  it("is a registry section of the Arbeitszeit page that owns exactly this key", () => {
    const section = settingsSection("arbeitszeit-terminabgleich");
    expect(section.page).toBe("/verwalten/regeln/arbeitszeit");
    expect(section.endpoint).toBe("/settings/work");
    expect(section.keys).toEqual(["appointmentTimeHintsEnabled"]);
    expect(section.title).toBe("Abgleich mit Terminen");
    expect(section.renderedBy).toBe(
      "lib/components/admin/arbeitszeit/AppointmentHintsSection.svelte",
    );
  });

  it("opens under the same alternatives as the neighbouring Einträge sections", () => {
    const own = settingsSection("arbeitszeit-terminabgleich");
    const neighbour = settingsSection("arbeitszeit-rueckwirkend");
    expect(own.requires).toEqual(neighbour.requires);
    const admin = { permissions: ["tenant-settings:update:ZUGEWIESEN"] };
    expect(mayOpenSection(admin, own)).toBe(true);
    expect(mayOpenSection({ permissions: [] }, own)).toBe(false);
  });

  it("sits in the tab „Einträge“ and answers to the hash #terminabgleich", () => {
    const tab = ARBEITSZEIT_TABS.find((t) => t.value === "eintraege");
    expect(tab?.sections).toContain("arbeitszeit-terminabgleich");
    expect(ARBEITSZEIT_TAB_ALIASES.terminabgleich).toBe("eintraege");
  });
});
