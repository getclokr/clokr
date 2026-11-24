/**
 * Issue #986 — „Monat bis gestern“ of Heute im Salon. `GET /dashboard/team-trend` names the
 * recorded working time apart from the account's Ist:
 *
 *  - `recordedMinutes` sums closed, valid WORK entries through the tenant-local yesterday, in the
 *    filtered salon (or over every listed person unfiltered). It holds no Berufsschule credit, and
 *    under a salon filter it equals the sum of the Salonansicht's entries of the same days
 *    (`GET /time-entries?salonId`), which is the figure a reader compares it with.
 *  - `toDateWorkedMinutes` / `toDateShouldMinutes` are the account's own to-date figures (the
 *    header of `GET /overtime/month-saldo`: through yesterday, credits included). Since #1011 the
 *    to-date Ist is sent for every unfiltered answer (the chart draws it), the to-date Soll only
 *    where the Soll is shown. The credit is their difference to the recorded time - never inside it.
 *  - `workedMinutes` / `shouldMinutes` stay the whole-month figures of `/reports/monthly` (the chart
 *    series, pinned by dashboard-team-trend-84).
 *
 * Fake clock 2026-06-15T10:00Z (Monday) installed before the app boots; June is the running month.
 * Synthetic fixture, no person names.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { normalizeRolePermissions, roleNameKey, SYSTEM_ROLE_IDS } from "../../contexts/platform";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
  createTestSalon,
} from "./../../__tests__/setup";

type TrendMonth = {
  month: string;
  workedMinutes: number;
  shouldMinutes: number | null;
  recordedMinutes: number;
  toDateWorkedMinutes: number | null;
  toDateShouldMinutes: number | null;
};
type Trend = {
  asOf: string;
  workedBasis: string;
  sollUnavailableReason: string | null;
  recordedBasis: string;
  months: TrendMonth[];
};
type SalonViewRow = {
  type: string;
  endTime: string | null;
  isInvalid: boolean;
  date: string;
  workingMinutes: number | null;
};

describe("Issue #986 — team-trend recorded time vs. account Ist", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let salonA: string;
  let salonB: string;
  const personIds: string[] = [];

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-15T10:00:00.000Z"));
    app = await getTestApp();
    data = await seedTestData(app, "tt986");
    salonA = data.salonId;
    salonB = (await createTestSalon(app.prisma, data.tenant.id, { name: "Trend986 B" })).id;

    let n = 0;
    async function person(label: string, homeSalon: string) {
      n += 1;
      const user = await app.prisma.user.create({
        data: {
          email: `tt986-${label}-${Date.now().toString(36)}${n}@example.invalid`,
          passwordHash: "x",
          isActive: true,
        },
      });
      const employee = await app.prisma.employee.create({
        data: {
          tenantId: data.tenant.id,
          userId: user.id,
          employeeNumber: `986${Date.now().toString().slice(-6)}${n}`,
          firstName: label,
          lastName: "Trend986",
          hireDate: new Date("2024-01-01T00:00:00Z"),
        },
      });
      await app.prisma.workSchedule.create({
        data: {
          employeeId: employee.id,
          type: "FIXED_SCHEDULE",
          weeklyHours: 40,
          mondayHours: 8,
          tuesdayHours: 8,
          wednesdayHours: 8,
          thursdayHours: 8,
          fridayHours: 8,
          saturdayHours: 0,
          sundayHours: 0,
          workDays: [1, 2, 3, 4, 5],
          validFrom: new Date("2024-01-01T00:00:00Z"),
        },
      });
      await app.prisma.employeeSalonAssignment.create({
        data: {
          tenantId: data.tenant.id,
          employeeId: employee.id,
          salonId: homeSalon,
          kind: "HOME",
          validFrom: new Date("2024-01-01T00:00:00Z"),
          validUntil: null,
        },
      });
      personIds.push(employee.id);
      return employee;
    }
    function entry(
      employeeId: string,
      salonId: string,
      date: string,
      start: string,
      end: string,
      extra: Record<string, unknown> = {},
    ) {
      return app.prisma.timeEntry.create({
        data: {
          employeeId,
          salonId,
          date: new Date(`${date}T00:00:00Z`),
          startTime: new Date(`${date}T${start}:00Z`),
          endTime: new Date(`${date}T${end}:00Z`),
          breakMinutes: 0,
          type: "WORK",
          source: "MANUAL",
          ...extra,
        },
      });
    }

    // P: 360 min in A, 180 min in B.
    const p = await person("p", salonA);
    await entry(p.id, salonA, "2026-06-08", "08:00", "14:00");
    await entry(p.id, salonB, "2026-06-09", "08:00", "11:00");

    // Azubi: 480 min in A on 10.06., Berufsschule on 11.06. (past) and on 18.06. (future).
    const azubi = await person("azubi", salonA);
    await app.prisma.employee.update({
      where: { id: azubi.id },
      data: { classification: "AZUBI", birthDate: new Date("2010-06-01") },
    });
    await entry(azubi.id, salonA, "2026-06-10", "08:00", "16:00");
    for (const day of ["2026-06-11", "2026-06-18"]) {
      await app.prisma.absence.create({
        data: {
          employeeId: azubi.id,
          type: "VOCATIONAL_SCHOOL",
          source: "PATTERN",
          startDate: new Date(`${day}T00:00:00.000Z`),
          endDate: new Date(`${day}T00:00:00.000Z`),
          days: 1,
          halfDay: false,
          createdBy: "system",
        },
      });
    }

    // S: entries that are never recorded time through yesterday - closed today, and invalid.
    const s = await person("s", salonA);
    await entry(s.id, salonA, "2026-06-15", "08:00", "09:00");
    await entry(s.id, salonA, "2026-06-11", "08:00", "10:00", { isInvalid: true });
  }, 120_000);

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("dashboard-team-trend-recorded-986 cleanup failed:", err);
    }
    vi.useRealTimers();
    await closeTestApp();
  });

  async function getJson<T>(url: string): Promise<T> {
    const res = await app.inject({
      method: "GET",
      url,
      headers: { authorization: `Bearer ${data.adminToken}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as T;
  }
  const june = (t: Trend) => t.months.find((m) => m.month === "2026-06")!;

  /** The Salonansicht's entries of June through yesterday, as a reader adds them up. */
  async function salonViewSum(salonId: string): Promise<number> {
    const rows = await getJson<SalonViewRow[]>(
      `/api/v1/time-entries?salonId=${salonId}&from=2026-06-01&to=2026-06-14`,
    );
    return rows
      .filter((r) => r.type === "WORK" && r.endTime !== null && !r.isInvalid)
      .reduce((sum, r) => sum + (r.workingMinutes ?? 0), 0);
  }

  it("under a salon filter the recorded time equals the Salonansicht sum of the same days", async () => {
    for (const salonId of [salonA, salonB]) {
      const t = await getJson<Trend>(`/api/v1/dashboard/team-trend?months=1&salonId=${salonId}`);
      expect(t.recordedBasis).toBe("SALON_ENTRIES");
      const viewSum = await salonViewSum(salonId);
      expect(june(t).recordedMinutes).toBe(viewSum);
      expect(june(t).workedMinutes).toBe(viewSum);
      // No Soll under a filter, so no account to-date figures either.
      expect(june(t).toDateWorkedMinutes).toBeNull();
      expect(june(t).toDateShouldMinutes).toBeNull();
    }
    expect(await salonViewSum(salonA)).toBe(360 + 480);
    expect(await salonViewSum(salonB)).toBe(180);
  });

  it("unfiltered, the recorded time holds no Berufsschule credit and no future day", async () => {
    const t = await getJson<Trend>("/api/v1/dashboard/team-trend?months=1");
    expect(t.recordedBasis).toBe("ALL_ENTRIES");
    expect(june(t).recordedMinutes).toBe(360 + 180 + 480);
    expect(june(t).recordedMinutes).toBe(
      (await salonViewSum(salonA)) + (await salonViewSum(salonB)),
    );
  });

  it("the account's to-date Ist and Soll equal the month-saldo headers of every listed person", async () => {
    const t = await getJson<Trend>("/api/v1/dashboard/team-trend?months=1");
    expect(t.workedBasis).toBe("ACCOUNT");
    let worked = 0;
    let should = 0;
    // Every person of the population (the seed's own employees included), as the trend lists them.
    const population = await app.prisma.employee.findMany({
      where: { tenantId: data.tenant.id },
      select: { id: true },
    });
    expect(population.length).toBeGreaterThanOrEqual(personIds.length);
    for (const { id } of population) {
      const ms = await getJson<{ workedMinutes: number; expectedMinutes: number }>(
        `/api/v1/overtime/month-saldo/${id}?year=2026&month=6`,
      );
      worked += ms.workedMinutes;
      should += ms.expectedMinutes;
    }
    expect(june(t).toDateWorkedMinutes).toBe(worked);
    expect(june(t).toDateShouldMinutes).toBe(should);
    // The past Berufsschule day is a credit of the account, named apart from the recorded time;
    // the future one is in neither to-date figure, only in the whole-month report figure.
    const credit = june(t).toDateWorkedMinutes! - june(t).recordedMinutes;
    expect(credit).toBeGreaterThan(0);
    expect(june(t).workedMinutes).toBeGreaterThan(june(t).toDateWorkedMinutes!);
  });

  // ── Issue #1011 — the chart draws the running month through yesterday ───────────────────────

  describe("Issue #1011 — the running month through yesterday, for every unfiltered caller", () => {
    const PASSWORD = "test1234";
    let overviewOnlyToken: string;
    let salonAOnlyToken: string;

    async function callerWith(
      label: string,
      permissions: string[] | { systemRoleId: string },
      scope: { scopeType: "TENANT" | "SALONS"; salonIds?: string[] },
    ): Promise<string> {
      const suffix = `${label}-${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`;
      const user = await app.prisma.user.create({
        data: {
          email: `tt1011-${suffix}@example.invalid`,
          passwordHash: await bcrypt.hash(PASSWORD, 4),
          isActive: true,
        },
      });
      await app.prisma.employee.create({
        data: {
          tenantId: data.tenant.id,
          userId: user.id,
          employeeNumber: `1011${suffix}`.toUpperCase().slice(0, 20),
          firstName: label,
          lastName: "Trend1011",
          hireDate: new Date("2024-01-01T00:00:00Z"),
          isTimeTrackingExempt: true,
        },
      });
      let accessRoleId: string;
      if (Array.isArray(permissions)) {
        const name = `Trend1011 ${crypto.randomBytes(3).toString("hex")}`;
        accessRoleId = (
          await app.prisma.accessRole.create({
            data: {
              tenantId: data.tenant.id,
              name,
              nameKey: roleNameKey(name),
              permissions: normalizeRolePermissions(permissions),
            },
          })
        ).id;
      } else {
        accessRoleId = permissions.systemRoleId;
      }
      await app.prisma.roleAssignment.create({
        data: {
          tenantId: data.tenant.id,
          userId: user.id,
          accessRoleId,
          scopeType: scope.scopeType,
          salonIds: scope.salonIds ?? [],
          employeeIds: [],
        },
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: user.email, password: PASSWORD },
      });
      expect(res.statusCode, res.body).toBe(200);
      return (JSON.parse(res.body) as { accessToken: string }).accessToken;
    }

    async function trendFor(token: string, query: string): Promise<Trend> {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/dashboard/team-trend${query}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode, res.body).toBe(200);
      return JSON.parse(res.body) as Trend;
    }

    beforeAll(async () => {
      overviewOnlyToken = await callerWith("ov", ["team-overview:read:ZUGEWIESEN"], {
        scopeType: "TENANT",
      });
      // A Springer homed in B with a past entry in A: for the manager of A the person is listed
      // by that entry only, so the Ist of the caller is the visible entry sum (SCOPE_ENTRIES).
      const springerUser = await app.prisma.user.create({
        data: {
          email: `tt1011-springer-${Date.now().toString(36)}@example.invalid`,
          passwordHash: "x",
          isActive: true,
        },
      });
      const springer = await app.prisma.employee.create({
        data: {
          tenantId: data.tenant.id,
          userId: springerUser.id,
          employeeNumber: `1011SP${Date.now().toString().slice(-6)}`,
          firstName: "springer",
          lastName: "Trend1011",
          hireDate: new Date("2024-01-01T00:00:00Z"),
        },
      });
      await app.prisma.employeeSalonAssignment.create({
        data: {
          tenantId: data.tenant.id,
          employeeId: springer.id,
          salonId: salonB,
          kind: "HOME",
          validFrom: new Date("2024-01-01T00:00:00Z"),
          validUntil: null,
        },
      });
      await app.prisma.timeEntry.create({
        data: {
          employeeId: springer.id,
          salonId: salonA,
          date: new Date("2026-06-12T00:00:00Z"),
          startTime: new Date("2026-06-12T08:00:00Z"),
          endTime: new Date("2026-06-12T10:00:00Z"),
          breakMinutes: 0,
          type: "WORK",
          source: "MANUAL",
        },
      });
      salonAOnlyToken = await callerWith(
        "sa",
        { systemRoleId: SYSTEM_ROLE_IDS.SALON_MANAGER },
        {
          scopeType: "SALONS",
          salonIds: [salonA],
        },
      );
    }, 60_000);

    it("names the Stichtag and keeps a past open month equal to its whole-month figures", async () => {
      const t = await getJson<Trend>("/api/v1/dashboard/team-trend?months=2");
      expect(t.asOf).toBe("2026-06-14");
      const may = t.months.find((m) => m.month === "2026-05")!;
      expect(may.toDateWorkedMinutes).toBe(may.workedMinutes);
      expect(may.toDateShouldMinutes).toBe(may.shouldMinutes);
      // The running month is the one that moves: its future Berufsschule day is whole-month only.
      expect(june(t).toDateWorkedMinutes!).toBeLessThan(june(t).workedMinutes);
      expect(june(t).toDateShouldMinutes!).toBeLessThan(june(t).shouldMinutes!);
    });

    it("a caller without overtime:read gets the to-date Ist, never a Soll", async () => {
      const admin = await getJson<Trend>("/api/v1/dashboard/team-trend?months=1");
      const t = await trendFor(overviewOnlyToken, "?months=1");
      expect(t.asOf).toBe("2026-06-14");
      expect(t.workedBasis).toBe("ACCOUNT");
      expect(t.sollUnavailableReason).toBe("NO_PERMISSION");
      expect(june(t).shouldMinutes).toBeNull();
      expect(june(t).toDateShouldMinutes).toBeNull();
      // Same population, same account to-date Ist as the admin's answer.
      expect(june(t).toDateWorkedMinutes).toBe(june(admin).toDateWorkedMinutes);
      expect(june(t).toDateWorkedMinutes!).toBeLessThan(june(t).workedMinutes);
      expect(june(t).toDateWorkedMinutes!).toBeGreaterThanOrEqual(june(t).recordedMinutes);
    });

    it("a salon-scoped caller's to-date Ist holds only visible entries through yesterday", async () => {
      const t = await trendFor(salonAOnlyToken, "?months=1");
      expect(t.workedBasis).toBe("SCOPE_ENTRIES");
      expect(june(t).toDateShouldMinutes).toBeNull();
      expect(typeof june(t).toDateWorkedMinutes).toBe("number");
      // The Springer's visible 120 min are in the to-date Ist; the covered Azubi adds the
      // account's to-date Ist (no future credit): the whole-month figure is larger.
      expect(june(t).recordedMinutes).toBeGreaterThanOrEqual(120);
      expect(june(t).toDateWorkedMinutes!).toBeLessThan(june(t).workedMinutes);
      expect(june(t).toDateWorkedMinutes!).toBeGreaterThanOrEqual(june(t).recordedMinutes);
    });

    it("under a salon filter the to-date pair stays null", async () => {
      const t = await getJson<Trend>(`/api/v1/dashboard/team-trend?months=1&salonId=${salonA}`);
      expect(june(t).toDateWorkedMinutes).toBeNull();
      expect(june(t).toDateShouldMinutes).toBeNull();
    });
  });
});
