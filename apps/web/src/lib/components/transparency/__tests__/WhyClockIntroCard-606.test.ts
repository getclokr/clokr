// Issue #606 - the „Warum stempeln?“ card on Mein Tag.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";

const savePreferences = vi.fn();
vi.mock("$api/preferences", () => ({
  savePreferences: (p: unknown) => savePreferences(p),
  fetchPreferences: vi.fn(),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("$stores/toast", () => ({
  toasts: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}));
const authState = vi.hoisted(() => ({
  set: (_permissions: string[]) => {},
}));
vi.mock("$stores/auth", async () => {
  const { writable } = await import("svelte/store");
  const store = writable({ user: { permissions: ["time-entry:create:EIGENE"] } });
  authState.set = (permissions) => store.set({ user: { permissions } });
  return { authStore: { subscribe: store.subscribe } };
});

import { prefsHydrated } from "$stores/prefs-state";
import { resetWhyClockIntro, setWhyClockIntroFromServer } from "$stores/why-clock-intro";
import WhyClockIntroCard from "../WhyClockIntroCard.svelte";

const baseProps = { exempt: false, ready: true };

beforeEach(() => {
  authState.set(["time-entry:create:EIGENE"]);
  resetWhyClockIntro();
  prefsHydrated.set(true);
  savePreferences.mockResolvedValue({ whyClockIntroSeen: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WhyClockIntroCard", () => {
  it("is hidden while the seen state is unknown or true", () => {
    renderWithTheme(WhyClockIntroCard, baseProps);
    expect(screen.queryByTestId("why-clock-intro")).not.toBeInTheDocument();
    cleanup();
    setWhyClockIntroFromServer(true);
    renderWithTheme(WhyClockIntroCard, baseProps);
    expect(screen.queryByTestId("why-clock-intro")).not.toBeInTheDocument();
  });

  it("is hidden for an exempt person, before the page is ready and without time-entry:create:EIGENE", () => {
    setWhyClockIntroFromServer(false);
    renderWithTheme(WhyClockIntroCard, { exempt: true, ready: true });
    expect(screen.queryByTestId("why-clock-intro")).not.toBeInTheDocument();
    cleanup();
    renderWithTheme(WhyClockIntroCard, { exempt: false, ready: false });
    expect(screen.queryByTestId("why-clock-intro")).not.toBeInTheDocument();
    cleanup();
    authState.set([]);
    renderWithTheme(WhyClockIntroCard, baseProps);
    expect(screen.queryByTestId("why-clock-intro")).not.toBeInTheDocument();
  });

  it("shows the title, three points with their legal anchor and both buttons as type=button", () => {
    setWhyClockIntroFromServer(false);
    renderWithTheme(WhyClockIntroCard, baseProps);
    expect(screen.getByRole("heading", { name: "Warum stempeln?" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText(/C-55\/18/)).toBeInTheDocument();
    expect(screen.getByText(/§§ 3 bis 5 ArbZG/)).toBeInTheDocument();
    for (const name of ["Verstanden", "Überspringen"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("type", "button");
    }
    expect(screen.getByRole("link", { name: /Wer sieht meine Zeiten\?/ })).toHaveAttribute(
      "href",
      "/ich/profil#wer-sieht-meine-zeiten",
    );
  });

  it.each(["Verstanden", "Überspringen"])(
    "%s stores the seen state once, acknowledges with the toast text and hides the card",
    async (name) => {
      setWhyClockIntroFromServer(false);
      const onDismissed = vi.fn();
      renderWithTheme(WhyClockIntroCard, { ...baseProps, onDismissed });
      await fireEvent.click(screen.getByRole("button", { name }));
      await waitFor(() => expect(screen.queryByTestId("why-clock-intro")).not.toBeInTheDocument());
      expect(savePreferences).toHaveBeenCalledTimes(1);
      expect(savePreferences).toHaveBeenCalledWith({ whyClockIntroSeen: true });
      expect(toastSuccess).toHaveBeenCalledWith(
        "Ausgeblendet. „Warum stempeln?“ findest du jederzeit im Profil.",
      );
      expect(onDismissed).toHaveBeenCalledTimes(1);
    },
  );

  it("a failed PUT shows the error toast and keeps the card hidden for the visit", async () => {
    setWhyClockIntroFromServer(false);
    savePreferences.mockRejectedValueOnce(new Error("offline"));
    renderWithTheme(WhyClockIntroCard, baseProps);
    await fireEvent.click(screen.getByRole("button", { name: "Verstanden" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError).toHaveBeenCalledWith(
      "Der Einstieg ließ sich nicht ausblenden. Er erscheint beim nächsten Mal wieder.",
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.queryByTestId("why-clock-intro")).not.toBeInTheDocument();
  });

  it("keyboard: both buttons are native, focusable and follow the footer link in tab order", async () => {
    setWhyClockIntroFromServer(false);
    renderWithTheme(WhyClockIntroCard, baseProps);
    const link = screen.getByRole("link", { name: /Wer sieht meine Zeiten\?/ });
    const understood = screen.getByRole("button", { name: "Verstanden" });
    const skip = screen.getByRole("button", { name: "Überspringen" });
    for (const button of [understood, skip]) {
      expect(button.tagName).toBe("BUTTON"); // Enter and Space activate a native button
      expect(button).not.toBeDisabled();
      expect(button.getAttribute("tabindex")).toBeNull();
      button.focus();
      expect(button).toHaveFocus();
    }
    const order = [link, understood, skip];
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });
});
