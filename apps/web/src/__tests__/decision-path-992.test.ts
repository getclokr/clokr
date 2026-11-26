// Issue #992 (N-07, N-09, S-27; owner decision 25.11.2026) - one decision path. Heute im Salon decides
// nothing (its row links to Aufgaben), the review dialog reads like the concept, and the facts name
// the Stammsalon in every multi-salon company.
vi.mock("$stores/auth", () => ({ authStore: { subscribe: () => () => {} } }));

const apiGet = vi.fn();
const apiPatch = vi.fn();
vi.mock("$api/client", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
  },
}));

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { screen, waitFor } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import LeaveReviewDialog from "$lib/components/leave/LeaveReviewDialog.svelte";
import { salonContext } from "$stores/salon-context";
import type { LeaveReviewRequest } from "$lib/leave/leave-review";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const DASHBOARD = read("../routes/(app)/dashboard/+page.svelte");
const TEAM_LEAVE = read("../routes/(app)/team/leave/+page.svelte");

function request(overrides: Partial<LeaveReviewRequest> = {}): LeaveReviewRequest {
  return {
    id: "req-1",
    employeeId: "emp-1",
    typeCode: "VACATION",
    employee: { firstName: "Alex", lastName: "Muster" },
    startDate: "2026-12-01",
    endDate: "2026-12-02",
    days: 2,
    halfDay: false,
    status: "PENDING",
    note: "Brückentag",
    attestPresent: false,
    attestValidFrom: null,
    attestValidTo: null,
    ...overrides,
  };
}

function mount(overrides: Partial<LeaveReviewRequest> = {}, flags: Record<string, boolean> = {}) {
  return renderWithTheme(LeaveReviewDialog, {
    open: true,
    request: request(overrides),
    currentEmployeeId: "manager-1",
    onReviewed: vi.fn(),
    ...flags,
  });
}

beforeEach(() => {
  apiGet.mockReset();
  apiPatch.mockReset();
  apiGet.mockResolvedValue([]);
  salonContext.reset();
});

describe("one decision path (D-992-13)", () => {
  it("the dashboard mounts no review dialog and has no openReview", () => {
    expect(DASHBOARD).not.toContain("LeaveReviewDialog");
    expect(DASHBOARD).not.toContain("openReview");
  });

  it("the Aufgaben widget row links „Prüfen“ through inboxRequestHref and keeps „Öffnen“ for other kinds", () => {
    expect(DASHBOARD).toMatch(/href=\{reviewHref\}[^]{0,40}>Prüfen</);
    expect(DASHBOARD).toContain("inboxRequestHref(request.id, request.startDate)");
    expect(DASHBOARD).toContain(">Öffnen<");
  });

  it("Team › Abwesenheiten links its open rows through inboxRequestHref and says „In Aufgaben prüfen“", () => {
    expect(TEAM_LEAVE).toContain("inboxRequestHref(req.id, req.startDate)");
    expect(TEAM_LEAVE).toContain("In Aufgaben prüfen");
    expect(TEAM_LEAVE).not.toContain("Im Posteingang prüfen");
  });
});

describe("the review dialog reads like the concept (D-992-14)", () => {
  it("the footer holds Abbrechen, Ablehnen, Genehmigen in this order, right-aligned, without a spacer or a reason text", () => {
    mount();
    const foot = document.querySelector(".modal-foot") as HTMLElement;
    expect(foot).toBeTruthy();
    expect(foot.querySelector(".spacer")).toBeNull();
    const labels = Array.from(foot.querySelectorAll("button")).map((b) => b.textContent?.trim());
    expect(labels).toEqual(["Abbrechen", "Ablehnen", "Genehmigen"]);
    expect(foot.textContent).not.toContain("Bitte nenne einen Grund.");
    expect((screen.getByTestId("leave-approval-modal-reject") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("the overlap heading reads „Im gleichen Zeitraum abwesend“", () => {
    mount();
    expect(screen.getByText("Im gleichen Zeitraum abwesend")).toBeTruthy();
    expect(screen.queryByText(/Kolleg:innen/)).toBeNull();
  });

  it("the § 7 note is one plain sentence with the legal basis behind an InfoHint, no „BUrlG § 7:“ prefix", () => {
    mount();
    const note = screen.getByTestId("review-burlg-notice");
    expect(note.textContent?.replace(/\s+/g, " ")).toContain(
      "Entscheide zeitnah: Urlaub muss im laufenden Jahr gewährt werden, sonst kann er am 31. März des Folgejahres verfallen.",
    );
    expect(note.textContent).not.toContain("BUrlG § 7:");
    expect(note.textContent).toContain("Grundlage: § 7 Abs. 3 BUrlG");
    expect(note.querySelector("button")).toBeTruthy();
  });
});

describe("the facts (D-992-15, D-992-16)", () => {
  const ASSIGNMENTS = {
    assignments: [
      {
        id: "a1",
        employeeId: "emp-1",
        salonId: "salon-nord",
        kind: "HOME",
        validFrom: "2026-01-01",
        validUntil: null,
        weekdays: [],
      },
    ],
  };

  async function loadContext(salons: { id: string; name: string }[], isMultiSalon = true) {
    apiGet.mockResolvedValueOnce({
      tenant: { id: "t1", name: "Test" },
      homeSalonId: null,
      isMultiSalon,
      salons,
    });
    await salonContext.load("u1", { force: true });
    apiGet.mockReset();
    apiGet.mockImplementation((path: string) =>
      Promise.resolve(path.includes("/salon-assignments") ? ASSIGNMENTS : []),
    );
  }

  it("shows „Stammsalon <name>“ when ONE reachable salon of a multi-salon company is the home salon", async () => {
    await loadContext([{ id: "salon-nord", name: "Salon Nord" }]);
    mount({}, { canReadEmployee: true });
    const line = await screen.findByTestId("review-fact-home-salon");
    expect(line.textContent).toContain("Stammsalon");
    expect(line.textContent).toContain("Salon Nord");
  });

  it("a home salon outside the reader's salons reads „Anderer Stammsalon“", async () => {
    await loadContext([{ id: "salon-ost", name: "Salon Ost" }]);
    mount({}, { canReadEmployee: true });
    const line = await screen.findByTestId("review-fact-home-salon");
    expect(line.textContent).toContain("Anderer Stammsalon");
  });

  it("a single-salon company shows no line", async () => {
    await loadContext([{ id: "salon-nord", name: "Salon Nord" }], false);
    mount({}, { canReadEmployee: true });
    await waitFor(() =>
      expect(apiGet.mock.calls.map((c) => String(c[0]))).toContain(
        "/employees/emp-1/salon-assignments",
      ),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("review-fact-home-salon")).toBeNull();
  });

  it("the note label reads „Anmerkung im Antrag“ and the period „1.12.–2.12.2026“", () => {
    mount();
    const facts = screen.getByTestId("leave-approval-modal-summary");
    expect(facts.textContent).toContain("Anmerkung im Antrag");
    expect(facts.textContent).not.toContain("Anmerkung Mitarbeiter");
    expect(facts.textContent).toContain("1.12.–2.12.2026");
  });
});
