/**
 * Issue #985 (D-01, D-02, D-02b, D-03) — the period report adds up: Saldo Beginn + Σ Saldo Zeitraum =
 * Saldo Ende for every row that shows both ends.
 *
 * Two causes were fixed together:
 *   - D-01: an open month contributed the WHOLE-month Soll (`fullMonth`, P-03 of #451, the
 *     Stundennachweis model) while its Gesamtsaldo runs through tenant-local yesterday. The period
 *     report now reads the account's to-date triple (`MonthReportFigures.toDate`); `/reports/monthly`
 *     keeps the whole-month Soll.
 *   - D-02: the opening was the computed Gesamtsaldo of the month before `from`, which for a month
 *     before the first stored close is walked open from the hire date. A closed first month now opens
 *     with its stored carry-in (`MonthReportFigures.carryInMinutes` = carryOver − balanceMinutes).
 *   - D-02b: a closed TRACK-ONLY month stores carryOver 0 and the raw balance, so its difference is no
 *     carry-in; such a first month keeps the previous month's Gesamtsaldo as its opening.
 *
 * Fixture (tenant Europe/Berlin, `Date` faked to 2026-11-15T10:00Z, a Sunday: November is the running
 * month, tenant-local yesterday is Saturday 14.11., the rest of November still owes 11 workdays, so the
 * whole-month and the to-date Soll differ):
 *   A  hire 2026-09-01, September closed (−480 balance, carryOver 20: an opening balance of 500 folded
 *      into the first close), October unclosed, entries in October and November
 *   B  hire 2025-01-01, never closed, entries September..November
 *   C  hire 2024-03-01, zero pre-tracking snapshots January..September 2026, October closed (+120),
 *      NO December-2025 snapshot, entries in November (the dev repro of the issue)
 *   M  hire 2025-01-01, MONTHLY_HOURS 40 h, two November entries (the Minijob row)
 *   T  hire 2025-01-01, MONTHLY_HOURS 40 h with overtimeMode TRACK_ONLY, September closed as a
 *      track-only close stores it (balance 600, carryOver 0), entries in October and November
 * Cases: (a) the running month alone, (b) a quarter ending in the running month, (c) a year with zero
 * pre-tracking snapshots and no snapshot for the month before `from`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp, seedTestData, cleanupTestData } from "./setup";
import { createPopulationPerson } from "./population-fixtures-613";
import { saldoSnapshotPeriodBounds } from "./test-dates";
import {
  computeMonthReportFigures,
  computeMonthReportFiguresForMany,
  monthReportFiguresKey,
  type MonthReportFiguresRequest,
} from "../contexts/working-time-account";

const FAKE_NOW = "2026-11-15T10:00:00.000Z";

type MonthEntry = {
  year: number;
  month: number;
  workedMinutes: number;
  expectedMinutes: number | null;
  balanceMinutes: number | null;
  closingBalanceMinutes: number | null;
  confirmed: boolean;
  labelled: boolean;
};
type Row = {
  employeeId: string;
  employeeNumber: string;
  workedMinutes: number;
  expectedMinutes: number | null;
  balanceMinutes: number | null;
  openingBalanceMinutes: number | null;
  closingBalanceMinutes: number | null;
  months: MonthEntry[];
};
type Period = { rows: Row[]; kpis: { closingAsOf: string } };
type MonthSaldo = {
  workedMinutes: number;
  expectedMinutes: number;
  balanceMinutes: number;
  closed: boolean;
  days: Array<{ date: string; cumulativeSaldoMinutes: number }>;
};

const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

describe("Issue #985 — the period report adds up (Beginn + Σ Zeitraum = Ende)", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  const ids = {} as Record<"A" | "B" | "C" | "M" | "T", string>;

  function entry(employeeId: string, date: string) {
    return app.prisma.timeEntry.create({
      data: {
        employeeId,
        salonId: data.salonId,
        date: new Date(`${date}T00:00:00Z`),
        startTime: new Date(`${date}T08:00:00Z`),
        endTime: new Date(`${date}T16:00:00Z`),
        breakMinutes: 0,
        type: "WORK",
        source: "MANUAL",
      },
    });
  }

  async function snapshot(
    employeeId: string,
    year: number,
    month: number,
    f: { worked: number; expected: number; balance: number; carry: number; note?: string },
  ) {
    const bounds = saldoSnapshotPeriodBounds(new Date(Date.UTC(year, month - 1, 1)));
    await app.prisma.saldoSnapshot.create({
      data: {
        employeeId,
        periodType: "MONTHLY",
        periodStart: bounds.start,
        periodEnd: bounds.end,
        workedMinutes: f.worked,
        expectedMinutes: f.expected,
        balanceMinutes: f.balance,
        carryOver: f.carry,
        ...(f.note ? { note: f.note } : {}),
        closedAt: new Date(),
        closedBy: data.adminUser.id,
      },
    });
  }

  function get(url: string) {
    return app.inject({
      method: "GET",
      url,
      headers: { authorization: `Bearer ${data.adminToken}` },
    });
  }

  async function period(from: string, to: string): Promise<Period> {
    const res = await get(`/api/v1/reports/period?from=${from}&to=${to}`);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as Period;
  }

  const rowOf = (r: Period, id: string): Row => {
    const row = r.rows.find((x) => x.employeeId === id);
    if (!row) throw new Error(`row ${id} missing`);
    return row;
  };

  /**
   * The identity of D-03 for every row with both ends: opening + Σ balance = closing, and per listed
   * month closing(m) = closing(m-1) + balance(m). T is excluded by id: a labelled track-only row shows
   * its raw balance as Saldo Zeitraum while the account holds 0, so it cannot add up - the follow-up of
   * D-02b, not this issue. Returns the ids that were checked (anti-vacuity at the call site).
   */
  function assertIdentity(r: Period, label: string): Set<string> {
    const checked = new Set<string>();
    for (const row of r.rows) {
      if (row.employeeId === ids.T) continue;
      if (row.openingBalanceMinutes === null || row.closingBalanceMinutes === null) continue;
      const where = `${label} employee ${row.employeeNumber}`;
      expect(
        row.openingBalanceMinutes + (row.balanceMinutes ?? 0),
        `${where}: opening ${row.openingBalanceMinutes} + Σ balance ${row.balanceMinutes} ≠ closing ${row.closingBalanceMinutes}`,
      ).toBe(row.closingBalanceMinutes);
      let previous = row.openingBalanceMinutes;
      for (const m of row.months) {
        if (m.closingBalanceMinutes === null) continue;
        expect(
          previous + (m.balanceMinutes ?? 0),
          `${where} month ${m.year}-${m.month}: previous ${previous} + balance ${m.balanceMinutes} ≠ closing ${m.closingBalanceMinutes}`,
        ).toBe(m.closingBalanceMinutes);
        previous = m.closingBalanceMinutes;
      }
      checked.add(row.employeeId);
    }
    return checked;
  }

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FAKE_NOW));
    app = await getTestApp();
    data = await seedTestData(app, "rp985");

    const mk = async (tag: "A" | "B" | "C" | "M" | "T", hire: string) => {
      const p = await createPopulationPerson(app, {
        tenantId: data.tenant.id,
        salonId: data.salonId,
        tag: `R985${tag}`,
        hireDate: new Date(`${hire}T00:00:00Z`),
      });
      ids[tag] = p.employeeId;
    };
    await mk("A", "2026-09-01");
    await mk("B", "2025-01-01");
    await mk("C", "2024-03-01");
    await mk("M", "2025-01-01");
    await mk("T", "2025-01-01");

    await app.prisma.workSchedule.updateMany({
      where: { employeeId: ids.M },
      data: { type: "MONTHLY_HOURS", monthlyHours: 40, workDays: [1, 2, 3, 4, 5] },
    });
    await app.prisma.workSchedule.updateMany({
      where: { employeeId: ids.T },
      data: {
        type: "MONTHLY_HOURS",
        monthlyHours: 40,
        overtimeMode: "TRACK_ONLY",
        workDays: [1, 2, 3, 4, 5],
      },
    });

    // A: September closed; an opening balance of 500 folded into the first close (D-02).
    await snapshot(ids.A, 2026, 9, { worked: 10080, expected: 10560, balance: -480, carry: 20 });
    for (const d of ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]) {
      await entry(ids.A, d);
    }
    for (const d of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]) {
      await entry(ids.A, d);
    }

    // B: never closed.
    for (const d of [
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
    ]) {
      await entry(ids.B, d);
    }

    // C: zero pre-tracking snapshots January..September 2026, October closed, no December 2025.
    for (let month = 1; month <= 9; month++) {
      await snapshot(ids.C, 2026, month, {
        worked: 0,
        expected: 0,
        balance: 0,
        carry: 0,
        note: "Vor Erfassungsbeginn (Test 985)",
      });
    }
    await snapshot(ids.C, 2026, 10, { worked: 10680, expected: 10560, balance: 120, carry: 120 });
    for (const d of [
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
    ]) {
      await entry(ids.C, d);
    }

    // M: the Minijob row.
    for (const d of ["2026-11-03", "2026-11-10"]) await entry(ids.M, d);

    // T: a track-only close stores the raw balance and carryOver 0 (#494).
    await snapshot(ids.T, 2026, 9, { worked: 3000, expected: 2400, balance: 600, carry: 0 });
    for (const d of ["2026-10-06", "2026-11-04"]) await entry(ids.T, d);
  });

  afterAll(async () => {
    vi.useRealTimers();
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("reports-period-identity-985 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("(a) the running month alone adds up and equals the account's month answer", async () => {
    const r = await period("2026-11", "2026-11");
    expect(r.kpis.closingAsOf).toBe("2026-11-14");
    const checked = assertIdentity(r, "(a)");
    for (const tag of ["A", "B", "C", "M"] as const) {
      expect(checked.has(ids[tag]), `(a) ${tag} must be among the checked rows`).toBe(true);
    }
    for (const tag of ["A", "B", "C", "M"] as const) {
      const row = rowOf(r, ids[tag]);
      const nov = row.months.find((m) => m.year === 2026 && m.month === 11)!;
      const res = await get(`/api/v1/overtime/month-saldo/${ids[tag]}?year=2026&month=11`);
      expect(res.statusCode, res.body).toBe(200);
      const account = JSON.parse(res.body) as MonthSaldo;
      expect(account.closed).toBe(false);
      expect(
        {
          workedMinutes: nov.workedMinutes,
          expectedMinutes: nov.expectedMinutes,
          balanceMinutes: nov.balanceMinutes,
        },
        `(a) ${tag} November = the account's to-date header`,
      ).toEqual({
        workedMinutes: account.workedMinutes,
        expectedMinutes: account.expectedMinutes,
        balanceMinutes: account.balanceMinutes,
      });
      expect(account.days.at(-1)?.date).toBe("2026-11-14");
      expect(nov.closingBalanceMinutes).toBe(account.days.at(-1)!.cumulativeSaldoMinutes);
    }
  });

  it("(b) a quarter ending in the running month adds up; A opens with the stored carry-in", async () => {
    const r = await period("2026-09", "2026-11");
    const checked = assertIdentity(r, "(b)");
    for (const tag of ["A", "B"] as const) {
      expect(checked.has(ids[tag]), `(b) ${tag} must be among the checked rows`).toBe(true);
    }
    // D-02: September is closed; 20 − (−480) = 500, the opening balance folded into the first close.
    expect(rowOf(r, ids.A).openingBalanceMinutes).toBe(500);
    // B has no snapshot: the open first month keeps the previous month's Gesamtsaldo.
    const bAug = await computeMonthReportFigures(app, ids.B, 2026, 8);
    expect(rowOf(r, ids.B).openingBalanceMinutes).toBe(bAug.closingBalanceMinutes);
  });

  it("(b) D-02b: a closed track-only first month keeps the previous month's Gesamtsaldo", async () => {
    const r = await period("2026-09", "2026-11");
    const tAug = await computeMonthReportFigures(app, ids.T, 2026, 8);
    expect(tAug.labelled).toBe(true);
    const opening = rowOf(r, ids.T).openingBalanceMinutes;
    expect(opening).toBe(tAug.closingBalanceMinutes);
    // never the Scheinminus 0 − 600 of a track-only close
    expect(opening).not.toBe(-600);
  });

  it("(c) a year with zero pre-tracking snapshots opens at 0 and ends at the live saldo", async () => {
    const r = await period("2026-01", "2026-11");
    const checked = assertIdentity(r, "(c)");
    for (const tag of ["B", "C", "M"] as const) {
      expect(checked.has(ids[tag]), `(c) ${tag} must be among the checked rows`).toBe(true);
    }
    const c = rowOf(r, ids.C);
    const cDec = await computeMonthReportFigures(app, ids.C, 2025, 12);
    // The computed pre-history (the dev repro: −3.672:00) is negative; the stored chain starts at 0.
    expect(cDec.closingBalanceMinutes).not.toBeNull();
    expect(cDec.closingBalanceMinutes!).toBeLessThan(0);
    expect(c.openingBalanceMinutes).toBe(0);
    const res = await get(`/api/v1/overtime/${ids.C}`);
    expect(res.statusCode, res.body).toBe(200);
    const live = JSON.parse(res.body) as { balanceHours: number };
    expect(hours(c.closingBalanceMinutes!)).toBe(live.balanceHours);
  });

  it("/reports/monthly still prints the whole-month Soll of the running month (P-03 of #451)", async () => {
    const f = await computeMonthReportFigures(app, ids.B, 2026, 11);
    expect(f.basis).toBe("fullMonth");
    expect(f.toDate).toBeDefined();
    expect(f.expectedMinutes).toBeGreaterThan(f.toDate!.expectedMinutes);
    const res = await get(`/api/v1/reports/monthly?year=2026&month=11`);
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as {
      rows: Array<{ employeeId: string; shouldHours: number | null }>;
    };
    const row = body.rows.find((x) => x.employeeId === ids.B)!;
    expect(row.shouldHours).toBe(hours(f.expectedMinutes));
  });

  it("toDate rides on open labelled answers, carryInMinutes on closed non-track-only ones", async () => {
    for (const tag of ["A", "B", "C", "M", "T"] as const) {
      const nov = await computeMonthReportFigures(app, ids[tag], 2026, 11);
      expect(nov.confirmed, `${tag} November is open`).toBe(false);
      expect("toDate" in nov, `${tag} November carries toDate`).toBe(true);
      expect("carryInMinutes" in nov, `${tag} November carries no carryInMinutes`).toBe(false);
    }
    const aSep = await computeMonthReportFigures(app, ids.A, 2026, 9);
    expect(aSep.confirmed).toBe(true);
    expect("toDate" in aSep).toBe(false);
    expect(aSep.carryInMinutes).toBe(500);
    const cOct = await computeMonthReportFigures(app, ids.C, 2026, 10);
    expect("toDate" in cOct).toBe(false);
    expect(cOct.carryInMinutes).toBe(0);
    const tSep = await computeMonthReportFigures(app, ids.T, 2026, 9);
    expect(tSep.confirmed).toBe(true);
    expect(tSep.labelled).toBe(true);
    expect("carryInMinutes" in tSep, "a track-only close carries no carry-in (D-02b)").toBe(false);
    expect("toDate" in tSep).toBe(false);
  });

  it("the bulk read answers every pair exactly like the single read (#696/#688 parity)", async () => {
    const requests: MonthReportFiguresRequest[] = (["A", "B", "C", "M", "T"] as const).flatMap(
      (tag) => [9, 10, 11].map((month) => ({ employeeId: ids[tag], year: 2026, month })),
    );
    const many = await computeMonthReportFiguresForMany(app, data.tenant.id, requests);
    expect(many.size).toBe(requests.length);
    for (const r of requests) {
      const single = await computeMonthReportFigures(app, r.employeeId, r.year, r.month);
      expect(
        many.get(monthReportFiguresKey(r.employeeId, r.year, r.month)),
        `${r.employeeId} ${r.year}-${r.month}`,
      ).toEqual(single);
    }
  });

  it("changes no SaldoSnapshot or OvertimeAccount row (full-row comparison)", async () => {
    const personIds = Object.values(ids);
    const state = async () => ({
      snapshots: await app.prisma.saldoSnapshot.findMany({
        where: { employeeId: { in: personIds } },
        orderBy: [{ id: "asc" }],
      }),
      accounts: await app.prisma.overtimeAccount.findMany({
        where: { employeeId: { in: personIds } },
        orderBy: [{ id: "asc" }],
      }),
    });
    const before = await state();
    expect(before.snapshots.length).toBe(12);
    await period("2026-11", "2026-11");
    await period("2026-09", "2026-11");
    await period("2026-01", "2026-11");
    expect(await state()).toEqual(before);
  });
});
