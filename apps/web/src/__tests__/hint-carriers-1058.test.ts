// Issue #1058 - the six description carriers take an additive `hint` prop: the explanation moves into
// an InfoHint beside the heading / label / legend, the old visible prop keeps its meaning and markup.
// One table over the carriers; each row has a positive control (the visible prop still renders its
// visible line), so the "no visible line for the hint" selectors can fail.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import { renderWithTheme } from "$tests/test-utils";
import { hintLabel } from "$components/ui/info-hint";
import FormField from "$components/ui/FormField.svelte";
import PageHeader from "$components/ui/PageHeader.svelte";
import ToggleField from "$components/admin/settings/ToggleField.svelte";
import WeekdayPicker from "$components/admin/settings/WeekdayPicker.svelte";
import SettingsGroup from "$components/admin/settings/SettingsGroup.svelte";
import Section from "$components/admin/Section.svelte";

afterEach(() => cleanup());

const HINT = "Das bedeutet diese Einstellung.";
const VISIBLE = "Das muss sichtbar bleiben.";

const field = createRawSnippet(
  (ctx: () => { id: string; describedBy: string | undefined; invalid: boolean }) => ({
    render: () => {
      const c = ctx();
      const desc = c.describedBy ? ` aria-describedby="${c.describedBy}"` : "";
      return `<input id="${c.id}"${desc} />`;
    },
  }),
);
const children = createRawSnippet(() => ({ render: () => "<p>Inhalt</p>" }));

interface Carrier {
  name: string;
  component: unknown;
  subject: string;
  /** Props of the carrier besides the hint and the visible prop. */
  base: Record<string, unknown>;
  /** The prop name that carries the visible line. */
  visibleProp: string;
  /** The old visible line's class. */
  visibleSelector: string;
  /** The element that must carry the hint id in its aria-describedby. */
  describedHost: () => HTMLElement;
  /** The element whose accessible name must stay exact. */
  named: () => HTMLElement;
  /** The heading / label / legend element itself, which must never contain the trigger. */
  subjectEl?: () => HTMLElement;
}

const noop = () => {};

const CARRIERS: Carrier[] = [
  {
    name: "FormField",
    component: FormField,
    subject: "Wochenstunden",
    base: { label: "Wochenstunden", field },
    visibleProp: "help",
    visibleSelector: ".ff-help",
    describedHost: () => screen.getByLabelText("Wochenstunden"),
    named: () => screen.getByLabelText("Wochenstunden"),
  },
  {
    name: "ToggleField",
    component: ToggleField,
    subject: "Gleitzeit",
    base: { label: "Gleitzeit", checked: false },
    visibleProp: "help",
    visibleSelector: ".tf-help",
    describedHost: () => screen.getByLabelText("Gleitzeit"),
    named: () => screen.getByLabelText("Gleitzeit"),
  },
  {
    name: "WeekdayPicker",
    component: WeekdayPicker,
    subject: "Arbeitstage",
    base: { legend: "Arbeitstage", value: [1, 2, 3] },
    visibleProp: "help",
    visibleSelector: ".wp-help",
    describedHost: () => screen.getByRole("group", { name: "Arbeitstage" }),
    named: () => screen.getByRole("group", { name: "Arbeitstage" }),
    subjectEl: () => screen.getByText("Arbeitstage", { selector: "legend" }),
  },
  {
    name: "SettingsGroup",
    component: SettingsGroup,
    subject: "Pausen",
    base: {
      title: "Pausen",
      changes: 0,
      errors: 0,
      saveLabel: "Pausen speichern",
      onSave: noop,
      onDiscard: noop,
      children,
    },
    visibleProp: "description",
    visibleSelector: ".settings-group-desc",
    describedHost: () => screen.getByRole("region", { name: "Pausen" }),
    named: () => screen.getByRole("heading", { level: 2, name: "Pausen" }),
  },
  {
    name: "Section",
    component: Section,
    subject: "Unternehmen",
    base: { title: "Unternehmen", children },
    visibleProp: "sub",
    visibleSelector: ".section-sub",
    describedHost: () => document.body,
    named: () => screen.getByText("Unternehmen"),
  },
  {
    name: "PageHeader",
    component: PageHeader,
    subject: "Aufgaben",
    base: { title: "Aufgaben" },
    visibleProp: "subtitle",
    visibleSelector: "p.sub",
    describedHost: () => document.body,
    named: () => screen.getByRole("heading", { level: 1, name: "Aufgaben" }),
  },
];

describe.each(CARRIERS.map((c) => [c.name, c] as const))("hint on %s", (_name, c) => {
  it("renders an InfoHint named hintLabel(subject) whose text element holds the hint, and no visible line", () => {
    const { container } = renderWithTheme(c.component as never, { ...c.base, hint: HINT });
    const trigger = screen.getByRole("button", { name: hintLabel(c.subject) });
    expect(trigger.getAttribute("type")).toBe("button");
    const text = document.getElementById(trigger.getAttribute("aria-describedby")!)!;
    expect(text.textContent).toBe(HINT);
    expect(container.querySelector(c.visibleSelector)).toBeNull();
    // The trigger sits beside the subject, never inside it.
    expect((c.subjectEl ?? c.named)().contains(trigger)).toBe(false);
  });

  it("keeps the accessible name of the heading / label / legend exact", () => {
    renderWithTheme(c.component as never, { ...c.base, hint: HINT });
    // getBy* with a string name is an exact match; it throws if the hint leaked into the name.
    expect(c.named()).toBeTruthy();
  });

  it("positive control: the visible prop still renders its visible line with the same text", () => {
    const { container } = renderWithTheme(c.component as never, {
      ...c.base,
      [c.visibleProp]: VISIBLE,
    });
    expect(container.querySelector(c.visibleSelector)?.textContent).toBe(VISIBLE);
    expect(screen.queryByRole("button", { name: hintLabel(c.subject) })).toBeNull();
  });

  it("hint and the visible prop together both render", () => {
    const { container } = renderWithTheme(c.component as never, {
      ...c.base,
      hint: HINT,
      [c.visibleProp]: VISIBLE,
    });
    expect(container.querySelector(c.visibleSelector)?.textContent).toBe(VISIBLE);
    expect(screen.getByRole("button", { name: hintLabel(c.subject) })).toBeTruthy();
  });
});

describe("hint wiring into aria-describedby", () => {
  it("FormField: the hint id comes first, then help, then error", () => {
    renderWithTheme(FormField, {
      label: "Wochenstunden",
      field,
      hint: HINT,
      help: "Hilfe",
      error: "Fehler",
    });
    const input = screen.getByLabelText("Wochenstunden");
    const ids = input.getAttribute("aria-describedby")!.split(" ");
    expect(ids).toHaveLength(3);
    expect(document.getElementById(ids[0])!.textContent).toBe(HINT);
    expect(document.getElementById(ids[1])!.textContent).toBe("Hilfe");
    expect(document.getElementById(ids[2])!.textContent).toContain("Fehler");
  });

  it("ToggleField: the checkbox lists the hint id, then the help id", () => {
    renderWithTheme(ToggleField, { label: "Gleitzeit", checked: false, hint: HINT, help: "Hilfe" });
    const ids = screen.getByLabelText("Gleitzeit").getAttribute("aria-describedby")!.split(" ");
    expect(document.getElementById(ids[0])!.textContent).toBe(HINT);
    expect(document.getElementById(ids[1])!.textContent).toBe("Hilfe");
  });

  it("WeekdayPicker: the fieldset lists the hint id", () => {
    renderWithTheme(WeekdayPicker, { legend: "Arbeitstage", value: [1], hint: HINT });
    const group = screen.getByRole("group", { name: "Arbeitstage" });
    expect(document.getElementById(group.getAttribute("aria-describedby")!)!.textContent).toBe(
      HINT,
    );
  });

  it("SettingsGroup: the section is described by the hint and still labelled by its title", () => {
    const { container } = renderWithTheme(SettingsGroup, {
      ...CARRIERS[3].base,
      hint: HINT,
    } as never);
    const section = container.querySelector("section")!;
    expect(document.getElementById(section.getAttribute("aria-describedby")!)!.textContent).toBe(
      HINT,
    );
    expect(document.getElementById(section.getAttribute("aria-labelledby")!)!.textContent).toBe(
      "Pausen",
    );
    expect(container.querySelector(".hint-row")).not.toBeNull();
  });
});
