// Issue #941 - the compact confirmation of „Genehmigen“ in a task row of Team › Aufgaben. Before, the
// row button approved at once (a test persona approved a request by accident). The confirmation
// shows the decision facts and writes nothing itself; only its own „Genehmigen“ calls `onConfirm`.
//
// Mocks as in LeaveReviewDialog.test.ts (`$stores/auth` cannot be resolved in vitest).
vi.mock("$stores/auth", () => ({ authStore: { subscribe: () => () => {} } }));

const apiGet = vi.fn();
const apiPatch = vi.fn();
vi.mock("$api/client", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
  },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import LeaveApproveConfirm from "../LeaveApproveConfirm.svelte";
import * as confirmModule from "../LeaveApproveConfirm.svelte";
import type { LeaveReviewRequest } from "$lib/leave/leave-review";

const TEXTS = confirmModule as unknown as {
  APPROVE_CONFIRM_TEXT: string;
  CANCELLATION_CONFIRM_TEXT: string;
};

function request(overrides: Partial<LeaveReviewRequest> = {}): LeaveReviewRequest {
  return {
    id: "req-1",
    employeeId: "emp-1",
    typeCode: "VACATION",
    employee: { firstName: "Alex", lastName: "Muster" },
    startDate: "2026-09-01",
    endDate: "2026-09-05",
    days: 5,
    halfDay: false,
    status: "PENDING",
    note: null,
    attestPresent: false,
    attestValidFrom: null,
    attestValidTo: null,
    ...overrides,
  };
}

const ENTITLEMENTS = [
  {
    typeCode: "VACATION",
    leaveType: { name: "Urlaub" },
    totalDays: 28,
    usedDays: 10,
    carriedOverDays: 4,
    effectiveCarryOverDays: 4,
  },
];
const SHIFTS = [{ date: "2026-09-01", startTime: "09:00", endTime: "17:00" }];

beforeEach(() => {
  apiGet.mockReset();
  apiPatch.mockReset();
  apiGet.mockImplementation((path: string) => {
    if (path.startsWith("/leave/entitlements/emp-1")) return Promise.resolve(ENTITLEMENTS);
    if (path.startsWith("/shifts/range")) return Promise.resolve(SHIFTS);
    return Promise.resolve([]);
  });
});

const paths = () => apiGet.mock.calls.map((c) => String(c[0]));

describe("LeaveApproveConfirm (#941)", () => {
  it("shows the decision facts: person, period, Resturlaub before -> after and the shifts", async () => {
    renderWithTheme(LeaveApproveConfirm, {
      open: true,
      request: request(),
      canReadEntitlement: true,
      canReadShifts: true,
      onConfirm: vi.fn(),
    });
    expect(screen.getByRole("dialog", { name: "Antrag genehmigen?" })).toBeTruthy();
    expect(screen.getByText(TEXTS.APPROVE_CONFIRM_TEXT)).toBeTruthy();
    const facts = screen.getByTestId("leave-approve-confirm-facts");
    expect(facts.textContent).toContain("Alex Muster");
    expect(facts.textContent).toContain("1.9.–5.9.2026");
    // 28 + 4 - 10 = 22 remaining; the request costs 5 days.
    expect((await screen.findByTestId("review-fact-vacation")).textContent).toContain(
      "22 → 17 Tage",
    );
    expect((await screen.findByTestId("review-fact-shifts")).textContent).toContain(
      "Di 1.9. · 09:00–17:00",
    );
  });

  it("omits a fact the caller may not read: no request is made for it", async () => {
    renderWithTheme(LeaveApproveConfirm, {
      open: true,
      request: request(),
      onConfirm: vi.fn(),
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(paths()).toEqual([]);
    expect(screen.queryByTestId("review-fact-vacation")).toBeNull();
    expect(screen.queryByTestId("review-fact-shifts")).toBeNull();
  });

  it("writes nothing itself: only its own „Genehmigen“ calls onConfirm", async () => {
    const onConfirm = vi.fn();
    renderWithTheme(LeaveApproveConfirm, { open: true, request: request(), onConfirm });
    expect(onConfirm).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "Genehmigen" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it("„Abbrechen“ decides nothing and reports the cancel", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderWithTheme(LeaveApproveConfirm, { open: true, request: request(), onConfirm, onCancel });
    await fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it("a cancellation request is named as such and confirmed with the danger button", () => {
    renderWithTheme(LeaveApproveConfirm, {
      open: true,
      request: request({ status: "CANCELLATION_REQUESTED" }),
      onConfirm: vi.fn(),
    });
    expect(screen.getByRole("dialog", { name: "Stornierung genehmigen?" })).toBeTruthy();
    expect(screen.getByText(TEXTS.CANCELLATION_CONFIRM_TEXT)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stornierung genehmigen" }).className).toContain(
      "btn-danger",
    );
  });
});
