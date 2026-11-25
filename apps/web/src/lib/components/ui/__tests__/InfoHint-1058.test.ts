// Issue #1058 - InfoHint, the one info symbol: a popover trigger that opens on keyboard focus, tap and
// hover, closes on Escape / blur / outside press, and keeps the explanation in an always-present text
// that the trigger points at with aria-describedby.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import InfoHint from "../InfoHint.svelte";
import { hintLabel, HINT_HOVER_DELAY_MS } from "../info-hint";
import DialogWithInfoHint from "./fixtures/DialogWithInfoHint.svelte";
import hintSource from "../InfoHint.svelte?raw";

afterEach(() => {
  cleanup();
  document.querySelectorAll("#app-root").forEach((e) => e.remove());
});

const TEXT = "Der Anspruch gilt je Kalenderjahr.";

function renderHint(props: Record<string, unknown> = {}) {
  return renderWithTheme(InfoHint, { text: TEXT, label: hintLabel("Urlaubsanspruch"), ...props });
}

function trigger() {
  return screen.getByRole("button", { name: "Erklärung zu „Urlaubsanspruch“" });
}

/** Keyboard focus: a focus event with no pointerdown before it. */
async function keyboardFocus(el: HTMLElement) {
  el.focus();
  await fireEvent.focus(el);
}

describe("hintLabel", () => {
  it("names the subject in German typographic quotes", () => {
    expect(hintLabel("Urlaubsanspruch")).toBe("Erklärung zu „Urlaubsanspruch“");
  });
});

describe("InfoHint - trigger and always-present text", () => {
  it("is a type=button named by label, closed, described by a text that is in the DOM from the start", () => {
    renderHint({ testId: "hint-x" });
    const t = trigger();
    expect(t.getAttribute("type")).toBe("button");
    expect(t.getAttribute("aria-expanded")).toBe("false");
    const describedBy = t.getAttribute("aria-describedby")!;
    expect(describedBy).toBeTruthy();
    const textEl = document.getElementById(describedBy)!;
    expect(textEl.textContent).toBe(TEXT);
    expect(textEl.getAttribute("data-testid")).toBe("hint-x");
    expect(textEl.classList.contains("sr-only")).toBe(true);
    expect(t.getAttribute("data-testid")).toBe("hint-x-trigger");
    // Closed: no panel anywhere.
    expect(document.querySelector(".ih-pop")).toBeNull();
  });

  it("joins an array with spaces for the text element and shows one paragraph per entry", async () => {
    renderHint({ text: ["Erster Satz.", "Zweiter Satz."], testId: "hint-y" });
    expect(screen.getByTestId("hint-y").textContent).toBe("Erster Satz. Zweiter Satz.");
    await keyboardFocus(trigger());
    await waitFor(() => expect(document.querySelectorAll(".ih-pop p").length).toBe(2));
  });

  it("textId and triggerTestId are honoured", () => {
    renderHint({ textId: "my-id", triggerTestId: "my-trigger" });
    expect(trigger().getAttribute("aria-describedby")).toBe("my-id");
    expect(document.getElementById("my-id")!.textContent).toBe(TEXT);
    expect(screen.getByTestId("my-trigger")).toBe(trigger());
  });

  it("default tone renders the info icon, warn renders the warn mark", () => {
    const { container, unmount } = renderHint();
    expect(container.querySelector(".ih-mark")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    unmount();
    const warn = renderHint({ tone: "warn" });
    const mark = warn.container.querySelector(".ih-mark")!;
    expect(mark.textContent).toBe("!");
    expect(mark.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders the text as element text: markup in it is no markup, and the source has no {@html", async () => {
    renderHint({ text: 'Hinweis <img src=x onerror="alert(1)">' });
    await keyboardFocus(trigger());
    await waitFor(() => expect(document.querySelector(".ih-pop")).not.toBeNull());
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector(".ih-pop")!.textContent).toContain("<img src=x");
    expect(hintSource).not.toContain("{@html");
  });
});

describe("InfoHint - opening and closing", () => {
  it("keyboard focus opens it into a portaled panel outside the container; focus stays on the trigger", async () => {
    const { container } = renderHint();
    const t = trigger();
    await keyboardFocus(t);
    await waitFor(() => expect(t.getAttribute("aria-expanded")).toBe("true"));
    const pop = document.querySelector(".ih-pop")!;
    expect(pop.textContent).toBe(TEXT);
    expect(container.contains(pop), "the panel is portaled").toBe(false);
    expect(document.body.contains(pop)).toBe(true);
    expect(document.activeElement).toBe(t);
  });

  it("Escape closes it and focus stays on the trigger", async () => {
    renderHint();
    const t = trigger();
    await keyboardFocus(t);
    await waitFor(() => expect(t.getAttribute("aria-expanded")).toBe("true"));
    await fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(t.getAttribute("aria-expanded")).toBe("false"));
    expect(document.activeElement).toBe(t);
  });

  it("blur to an element outside the panel closes it", async () => {
    renderHint();
    const t = trigger();
    await keyboardFocus(t);
    await waitFor(() => expect(t.getAttribute("aria-expanded")).toBe("true"));
    await fireEvent.blur(t, { relatedTarget: document.body });
    await waitFor(() => expect(t.getAttribute("aria-expanded")).toBe("false"));
  });

  it("a tap (pointerdown, focus, click) opens it once; a second click closes it", async () => {
    renderHint();
    const t = trigger();
    await fireEvent.pointerDown(t, { pointerType: "touch" });
    // jsdom fires the focus event itself; a second, synthetic one would look like keyboard focus.
    t.focus();
    await fireEvent.pointerUp(t, { pointerType: "touch" });
    await fireEvent.click(t);
    await waitFor(() => expect(t.getAttribute("aria-expanded")).toBe("true"));
    expect(document.querySelectorAll(".ih-pop").length).toBe(1);
    await fireEvent.click(t);
    await waitFor(() => expect(t.getAttribute("aria-expanded")).toBe("false"));
  });

  it("an outside press closes it", async () => {
    renderHint();
    const t = trigger();
    await keyboardFocus(t);
    await waitFor(() => expect(t.getAttribute("aria-expanded")).toBe("true"));
    const press = { button: 0, pointerType: "mouse", clientX: 600, clientY: 600 };
    await fireEvent.pointerDown(document.body, press);
    await fireEvent.pointerUp(document.body, press);
    await fireEvent.click(document.body, press);
    await waitFor(() => expect(t.getAttribute("aria-expanded")).toBe("false"));
  });

  it("hover opens it after the delay for a mouse, not for a touch", async () => {
    renderHint();
    const t = trigger();
    // Positive control: a touch pointerenter opens nothing.
    await fireEvent.pointerEnter(t, { pointerType: "touch" });
    await new Promise((r) => setTimeout(r, HINT_HOVER_DELAY_MS + 100));
    expect(t.getAttribute("aria-expanded")).toBe("false");

    await fireEvent.pointerEnter(t, { pointerType: "mouse" });
    await waitFor(() => expect(t.getAttribute("aria-expanded")).toBe("true"), { timeout: 1500 });
  });
});

describe("InfoHint - inside a Dialog", () => {
  it("opens above the inert page, and Escape closes only the hint", async () => {
    const app = document.createElement("div");
    app.id = "app-root";
    document.body.appendChild(app);
    const onOpenChange = vi.fn();
    renderWithTheme(DialogWithInfoHint, { onOpenChange });
    await waitFor(() => expect(app.hasAttribute("inert")).toBe(true));

    const t = trigger();
    await keyboardFocus(t);
    await waitFor(() => expect(t.getAttribute("aria-expanded")).toBe("true"));
    const pop = document.querySelector(".ih-pop")!;
    expect(pop.closest("[inert]"), "the panel is not inert").toBeNull();
    // Positive control: the page behind the dialog is.
    expect(app.closest("[inert]")).not.toBeNull();

    await fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(t.getAttribute("aria-expanded")).toBe("false"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("InfoHint - styling contract", () => {
  it("stacks above a Dialog on the content element itself", () => {
    expect(hintSource).toMatch(/\.ih-pop\s*\{[^}]*z-index:\s*1600/);
  });
});
