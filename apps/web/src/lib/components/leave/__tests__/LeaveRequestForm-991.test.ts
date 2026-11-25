// Issue #991 (N-15, N-16, N-17, M-34, M-35 button) — the Urlaub/Krank dialog keeps its buttons in
// the Dialog footer, names a Krankmeldung plainly, draws the day count with an icon and offers the
// nine types in one order. Mount pattern of LeaveRequestForm.test.ts.
const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
vi.mock("$api/client", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
  },
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import { toasts } from "$stores/toast";
import LeaveRequestForm from "../LeaveRequestForm.svelte";

const EMPLOYEE_ID = "emp-1";

function serveGets(path: string) {
  if (path.startsWith("/leave/entitlements/")) {
    return Promise.resolve([
      {
        typeCode: "VACATION",
        leaveType: { name: "Urlaub" },
        totalDays: 30,
        usedDays: 5,
        carriedOverDays: 0,
        effectiveCarryOverDays: 0,
        carryOverDeadline: null,
        provisionalUsedDays: 0,
      },
    ]);
  }
  if (path.startsWith("/leave/hours-preview")) {
    return Promise.resolve({ hours: 8, days: 1, minutesNeeded: 480 });
  }
  if (path.startsWith("/integrations/phorest/")) {
    return Promise.resolve({ total: 0, collisions: [], deepLink: null });
  }
  return Promise.resolve([]);
}

let success: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiPatch.mockReset();
  apiGet.mockImplementation(serveGets);
  apiPost.mockResolvedValue({ id: "req-1" });
  apiPatch.mockResolvedValue(undefined);
  success = vi.spyOn(toasts, "success").mockReturnValue(crypto.randomUUID());
  vi.spyOn(toasts, "error").mockReturnValue(crypto.randomUUID());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderForm(props: Partial<Record<string, unknown>> = {}) {
  const onSaved = vi.fn();
  renderWithTheme(LeaveRequestForm, {
    open: true,
    employeeId: EMPLOYEE_ID,
    editingRequest: null,
    onSaved,
    ...props,
  } as never);
  return { onSaved };
}

async function fill(start: string, end: string) {
  await fireEvent.input(screen.getByTestId("leave-form-from"), { target: { value: start } });
  await fireEvent.input(screen.getByTestId("leave-form-to"), { target: { value: end } });
}

describe("LeaveRequestForm footer (#991 N-15, M-35 button)", () => {
  it("renders Abbrechen then the submit button inside .modal-foot", () => {
    renderForm();
    const cancel = screen.getByTestId("leave-form-cancel");
    const submit = screen.getByTestId("leave-form-submit");
    const foot = cancel.closest(".modal-foot");
    expect(foot).not.toBeNull();
    expect(submit.closest(".modal-foot")).toBe(foot);
    // Secondary first, primary last.
    expect(cancel.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(submit.className).toContain("btn-primary");
  });

  it("the submit lives outside the form element and still submits it", async () => {
    const { onSaved } = renderForm();
    expect(screen.getByTestId("leave-form-submit").closest("form")).toBeNull();
    await fill("2026-11-10", "2026-11-10");
    await fireEvent.click(screen.getByTestId("leave-form-submit"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(apiPost).toHaveBeenCalledWith(
      "/leave/requests",
      expect.objectContaining({
        employeeId: EMPLOYEE_ID,
        type: "VACATION",
        startDate: "2026-11-10",
        endDate: "2026-11-10",
      }),
    );
  });

  it("no .form-actions row is left in the body", () => {
    renderForm();
    expect(document.querySelector(".form-actions")).toBeNull();
  });
});

describe("A Krankmeldung is no Antrag (#991 N-16, D-991-14)", () => {
  it("SICK: title, button, placeholder and no half-day option", async () => {
    const { onSaved } = renderForm({ initialTypeCode: "SICK" });
    expect(screen.getByRole("heading", { name: "Krank melden" })).toBeTruthy();
    expect(screen.getByTestId("leave-form-submit").textContent?.trim()).toBe("Krankmeldung senden");
    expect(screen.getByTestId("leave-form-note").getAttribute("placeholder")).toBe(
      "z. B. AU folgt",
    );
    expect(screen.queryByTestId("leave-form-half-day")).toBeNull();
    expect(screen.queryByText("Halbe Kranktage sind nicht zulässig")).toBeNull();

    await fill("2026-11-10", "2026-11-11");
    await fireEvent.click(screen.getByTestId("leave-form-submit"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(success).toHaveBeenCalledWith("Krankmeldung gesendet · 10.11.–11.11.2026");
  });

  it("SICK_CHILD reads the same way", () => {
    renderForm({ initialTypeCode: "SICK_CHILD" });
    expect(screen.getByRole("heading", { name: "Krank melden" })).toBeTruthy();
    expect(screen.queryByTestId("leave-form-half-day")).toBeNull();
  });

  it("switching to VACATION brings the request wording and the half-day toggle back", async () => {
    renderForm({ initialTypeCode: "SICK" });
    await fireEvent.change(screen.getByTestId("leave-form-type"), {
      target: { value: "VACATION" },
    });
    expect(screen.getByRole("heading", { name: "Neuer Abwesenheitsantrag" })).toBeTruthy();
    expect(screen.getByTestId("leave-form-submit").textContent?.trim()).toBe("Antrag einreichen");
    expect(screen.getByTestId("leave-form-half-day")).toBeTruthy();
    expect(screen.getByTestId("leave-form-note").getAttribute("placeholder")).toContain("Hochzeit");
  });
});

describe("Day count icon (#991 N-17)", () => {
  it("shows an svg and no calendar emoji", async () => {
    renderForm();
    await fill("2026-11-10", "2026-11-10");
    const bar = await screen.findByTestId("leave-form-days-calc");
    expect(bar.textContent).not.toContain("📅");
    expect(bar.querySelector("svg")).not.toBeNull();
  });
});

describe("One order of the absence types (#991 M-34, D-991-15)", () => {
  it("lists all nine types, Urlaub and Krankmeldung on top", () => {
    renderForm();
    const select = screen.getByTestId("leave-form-type") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual([
      "Urlaub",
      "Krankmeldung",
      "Überstundenausgleich",
      "Sonderurlaub",
      "Bildungsurlaub",
      "Kinderkrank",
      "Unbezahlter Urlaub",
      "Mutterschutz",
      "Elternzeit",
    ]);
  });
});
