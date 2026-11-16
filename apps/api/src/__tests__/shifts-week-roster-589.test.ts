/**
 * Issue #589 — the shift roster lists and counts every visible person, whatever the Arbeitszeitmodell.
 *
 * Owner decision 19.10.2026 (OD-589-1): "Alle Personen eines Salons stehen im Schichtplan und koennen
 * Schichten bekommen, unabhaengig vom Arbeitszeitmodell." OD-589-2 (explicitly NOT part of it): Soll
 * and saldo from shifts stay SHIFT_BASED-only. Acceptance criteria of 15.11.2026: Besetzung counts only
 * persons who are a row of the roster (AC-589-4), a closed day reports no understaffing (AC-589-7).
 *
 * Proves, on `GET /shifts/week` and `POST`/`PUT /shifts`:
 *   - D-589-04 contract presence: a FIXED_SCHEDULE / FLEXTIME person counts on a contract workday
 *     without a shift, exactly once when a shift exists, never when on leave, on a work-location
 *     holiday, outside the employment window or when a shift sits in another salon; MONTHLY_HOURS and
 *     SHIFT_BASED count only through a shift;
 *   - D-589-06 `coverage[].closed` for a salon in view and for the reach-wide case;
 *   - D-589-04 under a salon filter (Stammsalon per day) and for a scoped caller (leave not read);
 *   - D-589-02 every Arbeitszeitmodell can receive a shift when a contract is valid on the date;
 *   - D-589-05 everything counted in coverage is a row of the roster (cross-layer: the web helper);
 *   - OD-589-2 `contractSollMinutesByEmp` stays SHIFT_BASED-only.
 *
 * Fixture clock: week W1 = 2026-06-15 (Mo) .. 2026-06-21 (So), W2 = 2026-06-22 .. 2026-06-28; no
 * statutory holiday in NIEDERSACHSEN in either. Synthetic names only (CLAUDE.md PII rule).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import path from "path";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp, seedTestData, cleanupTestData, createTestSalon } from "./setup";
import { normalizeRolePermissions, roleNameKey } from "../contexts/platform";

const PASSWORD = "test1234";
const W1 = "date=2026-06-15";
const W2 = "date=2026-06-22";

type Coverage = {
  date: string;
  effectiveStaff: number;
  minStaff: number;
  coverageStatus: string;
  closed: boolean;
  contractEmployeeIds: string[];
};
type WeekBody = {
  employees: Array<{ id: string; workSchedules: unknown[] }>;
  shifts: Array<{ id: string; employeeId: string; date: string }>;
  coverage: Coverage[];
  contractWorkDaysByEmp: Record<string, string[]>;
  contractSollMinutesByEmp: Record<string, number> | null;
};

type Spec = {
  type: "FIXED_SCHEDULE" | "FLEXTIME" | "MONTHLY_HOURS" | "SHIFT_BASED";
  days?: [number, number, number, number, number, number, number]; // Mo..So hours
  workDays?: number[];
  weeklyHours?: number | null;
  monthlyHours?: number | null;
};

const MO_FR: Spec["days"] = [8, 8, 8, 8, 8, 0, 0];

// `withDefaultSalon: false` leaves the tenant with exactly the salons the file creates.
function seedNoDefaultSalon(app: FastifyInstance, suffix: string) {
  return seedTestData(app, suffix, { withDefaultSalon: false });
}

describe("Issue #589 — GET /shifts/week counts every visible person, every model can receive a shift", () => {
  let app: FastifyInstance;
  let t1: Awaited<ReturnType<typeof seedTestData>>;
  let t2: Awaited<ReturnType<typeof seedNoDefaultSalon>>;
  const created: string[] = [];

  let f1: string;
  let f2: string;
  let f3: string;
  let m1: string;
  let s1: string;
  let s2: string;
  let x: string;
  let noContract: string;

  let salonA: { id: string };
  let salonB: { id: string };
  let pa: string;
  let pb: string;
  let dd: string;
  let managerToken: string;

  function uniq(label: string): string {
    return `${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  async function mkPerson(
    tenantId: string,
    label: string,
    spec: Spec | null,
    opts: { hire?: string; exit?: string; validFrom?: string } = {},
  ) {
    const s = uniq(label);
    const user = await app.prisma.user.create({
      data: {
        email: `${s}@example.invalid`,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        isActive: true,
      },
    });
    const employee = await app.prisma.employee.create({
      data: {
        tenantId,
        userId: user.id,
        employeeNumber: s.toUpperCase().slice(0, 20),
        firstName: label,
        lastName: "Rost589",
        hireDate: new Date(`${opts.hire ?? "2024-01-01"}T00:00:00Z`),
        ...(opts.exit ? { exitDate: new Date(`${opts.exit}T00:00:00Z`) } : {}),
      },
    });
    if (spec) {
      const d = spec.days ?? MO_FR!;
      await app.prisma.workSchedule.create({
        data: {
          employeeId: employee.id,
          type: spec.type,
          weeklyHours: spec.weeklyHours === undefined ? 40 : spec.weeklyHours,
          monthlyHours: spec.monthlyHours ?? null,
          mondayHours: d![0],
          tuesdayHours: d![1],
          wednesdayHours: d![2],
          thursdayHours: d![3],
          fridayHours: d![4],
          saturdayHours: d![5],
          sundayHours: d![6],
          ...(spec.workDays ? { workDays: spec.workDays } : {}),
          ...(spec.type === "SHIFT_BASED"
            ? { contractWorkDaysPerWeek: 5, usualWorkDays: [1, 2, 3, 4, 5] }
            : {}),
          validFrom: new Date(`${opts.validFrom ?? "2024-01-01"}T00:00:00Z`),
        },
      });
    }
    return { user, employee };
  }

  function assign(
    tenantId: string,
    employeeId: string,
    salonId: string,
    kind: "HOME" | "DEPLOYMENT",
  ) {
    return app.prisma.employeeSalonAssignment.create({
      data: {
        tenantId,
        employeeId,
        salonId,
        kind,
        validFrom: new Date("2024-01-01T00:00:00Z"),
        validUntil: null,
      },
    });
  }

  function shiftRow(employeeId: string, salonId: string, date: string) {
    return app.prisma.shift.create({
      data: {
        employeeId,
        salonId,
        date: new Date(`${date}T00:00:00Z`),
        startTime: "09:00",
        endTime: "15:00",
      },
    });
  }

  async function week(token: string, q: string): Promise<WeekBody> {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/shifts/week?${q}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as WeekBody;
  }

  const day = (b: WeekBody, iso: string) => b.coverage.find((c) => c.date === iso)!;
  const staffByDay = (b: WeekBody) => b.coverage.map((c) => c.effectiveStaff);

  async function scopedManager(tenantId: string, salonIds: string[]): Promise<string> {
    const s = uniq("mgr");
    const user = await app.prisma.user.create({
      data: {
        email: `${s}@example.invalid`,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        isActive: true,
      },
    });
    await app.prisma.employee.create({
      data: {
        tenantId,
        userId: user.id,
        employeeNumber: s.toUpperCase().slice(0, 20),
        firstName: "Mgr",
        lastName: "Rost589",
        hireDate: new Date("2020-01-01T00:00:00Z"),
      },
    });
    const name = `Rost589 ${crypto.randomBytes(3).toString("hex")}`;
    const role = await app.prisma.accessRole.create({
      data: {
        tenantId,
        name,
        nameKey: roleNameKey(name),
        permissions: normalizeRolePermissions(["shift:read:ZUGEWIESEN"]),
      },
    });
    await app.prisma.roleAssignment.create({
      data: {
        tenantId,
        userId: user.id,
        accessRoleId: role.id,
        scopeType: "SALONS",
        salonIds,
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

  beforeAll(async () => {
    app = await getTestApp();

    // ── T1: one default salon (Sunday closed), the persons of the behaviour table ──────────
    t1 = await seedTestData(app, "r589a");
    created.push(t1.tenant.id);
    const mk = async (label: string, spec: Spec | null, opts = {}) => {
      const p = await mkPerson(t1.tenant.id, label, spec, opts);
      if (spec) await assign(t1.tenant.id, p.employee.id, t1.salonId, "HOME");
      return p.employee.id;
    };
    f1 = await mk("F1", { type: "FIXED_SCHEDULE" });
    f2 = await mk("F2", { type: "FIXED_SCHEDULE", days: [0, 8, 8, 8, 8, 8, 0] });
    f3 = await mk("F3", {
      type: "FLEXTIME",
      weeklyHours: 24,
      workDays: [1, 2, 3],
      days: [1, 1, 1, 0, 0, 0, 0],
    });
    m1 = await mk("M1", {
      type: "MONTHLY_HOURS",
      weeklyHours: null,
      monthlyHours: 40,
      workDays: [1, 2, 3, 4, 5],
      days: [0, 0, 0, 0, 0, 0, 0],
    });
    s1 = await mk("S1", { type: "SHIFT_BASED", weeklyHours: 32 });
    s2 = await mk("S2", { type: "SHIFT_BASED", weeklyHours: 32 });
    x = await mk("X", { type: "FIXED_SCHEDULE" }, { exit: "2026-06-01" });
    noContract = await mk("NC", null);

    await shiftRow(s2, t1.salonId, "2026-06-17");
    await shiftRow(f1, t1.salonId, "2026-06-18");
    await app.prisma.leaveRequest.create({
      data: {
        employeeId: f2,
        leaveTypeId: t1.vacationType.id,
        startDate: new Date("2026-06-17T00:00:00Z"),
        endDate: new Date("2026-06-17T00:00:00Z"),
        status: "APPROVED",
        days: 1,
      },
    });

    // ── T2: two salons with their own opening hours, no default salon ──────────────────────
    t2 = await seedNoDefaultSalon(app, "r589b");
    created.push(t2.tenant.id);
    const hours = (closedDays: number[]) =>
      [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        day: d,
        open: "09:00",
        close: "18:00",
        ...(closedDays.includes(d) ? { closed: true } : {}),
      }));
    salonA = await createTestSalon(app.prisma, t2.tenant.id, {
      name: "Rost589 Salon A",
      openingHours: hours([5, 6]),
    });
    salonB = await createTestSalon(app.prisma, t2.tenant.id, {
      name: "Rost589 Salon B",
      openingHours: hours([6]),
    });
    pa = (await mkPerson(t2.tenant.id, "PA", { type: "FIXED_SCHEDULE" })).employee.id;
    await assign(t2.tenant.id, pa, salonA.id, "HOME");
    await assign(t2.tenant.id, pa, salonB.id, "DEPLOYMENT");
    pb = (await mkPerson(t2.tenant.id, "PB", { type: "FIXED_SCHEDULE" })).employee.id;
    await assign(t2.tenant.id, pb, salonB.id, "HOME");
    dd = (await mkPerson(t2.tenant.id, "DD", { type: "FIXED_SCHEDULE" })).employee.id;
    await assign(t2.tenant.id, dd, salonB.id, "HOME");
    await assign(t2.tenant.id, dd, salonA.id, "DEPLOYMENT");
    await shiftRow(pa, salonB.id, "2026-06-16");
    await app.prisma.leaveRequest.create({
      data: {
        employeeId: dd,
        leaveTypeId: t2.vacationType.id,
        startDate: new Date("2026-06-17T00:00:00Z"),
        endDate: new Date("2026-06-17T00:00:00Z"),
        status: "APPROVED",
        days: 1,
      },
    });
    managerToken = await scopedManager(t2.tenant.id, [salonA.id]);
  });

  afterAll(async () => {
    for (const id of created) {
      try {
        await app.prisma.roleAssignment.deleteMany({ where: { tenantId: id } });
        await cleanupTestData(app, id);
      } catch (err) {
        console.error("shifts-week-roster-589 cleanup failed:", err);
      }
    }
    await closeTestApp();
  });

  // ── D-589-04: contract presence ─────────────────────────────────────────────────────────
  it("(a) a week without shifts counts every available fixed/flex person on each contract workday", async () => {
    const b = await week(t1.adminToken, W2);
    // Mo admin+employee+F1+F3, Di/Mi +F2, Do/Fr admin+employee+F1+F2, Sa F2, So nobody.
    expect(staffByDay(b)).toEqual([4, 5, 5, 4, 4, 1, 0]);
    expect(day(b, "2026-06-22").contractEmployeeIds).toContain(f1);
    expect(day(b, "2026-06-27").contractEmployeeIds).toEqual([f2]);
  });

  it("(b) a person with a shift on a contract day counts exactly once and is not marked by contract", async () => {
    const b = await week(t1.adminToken, W1);
    const thu = day(b, "2026-06-18");
    expect(thu.effectiveStaff).toBe(4); // admin, employee, F1 (shift), F2
    expect(thu.contractEmployeeIds).not.toContain(f1);
    expect(thu.contractEmployeeIds).toContain(f2);
    expect(b.shifts.some((s) => s.employeeId === f1 && s.date.startsWith("2026-06-18"))).toBe(true);
  });

  it("(c) MONTHLY_HOURS and SHIFT_BASED count only through a shift", async () => {
    const b = await week(t1.adminToken, W1);
    for (const c of b.coverage) {
      for (const id of [s1, s2, m1]) expect(c.contractEmployeeIds).not.toContain(id);
    }
    // S2 counts on Wednesday through its shift; F2 is on leave that day (see (e)).
    expect(day(b, "2026-06-17").effectiveStaff).toBe(5);
    // S1 has no shift: a Monday without S1 or M1 is admin, employee, F1, F3.
    expect(day(b, "2026-06-15").effectiveStaff).toBe(4);
  });

  it("(e) a person on approved leave is not counted by contract", async () => {
    const b = await week(t1.adminToken, W1);
    const wed = day(b, "2026-06-17");
    expect(wed.effectiveStaff).toBe(5); // admin, employee, F1, F3, S2 (shift)
    expect(wed.contractEmployeeIds).not.toContain(f2);
  });

  it("(h) the population is the persons employed in the week; a person without any contract is no row", async () => {
    const b = await week(t1.adminToken, W1);
    const ids = b.employees.map((e) => e.id);
    for (const id of [s1, m1, f1, f2, f3]) expect(ids).toContain(id);
    expect(ids).not.toContain(x); // exited 2026-06-01, before the week
    for (const c of b.coverage) expect(c.contractEmployeeIds).not.toContain(x);
    // The person without a WorkSchedule is listed by the server but carries no contract (the web
    // roster drops them: roster-rows-589.test.ts).
    const nc = b.employees.find((e) => e.id === noContract);
    expect(nc?.workSchedules ?? []).toEqual([]);
  });

  // ── D-589-06: closed days ───────────────────────────────────────────────────────────────
  it("(d1) a weekday closed in the only salon is closed, reads ok and keeps the rule's minStaff", async () => {
    const b = await week(t1.adminToken, W1);
    const sun = day(b, "2026-06-21");
    expect(sun.closed).toBe(true);
    expect(sun.coverageStatus).toBe("ok");
    expect(sun.minStaff).toBe(2); // the default rule value, never zeroed (#647 pins)
    expect(day(b, "2026-06-15").closed).toBe(false);
  });

  it("(d2) with two salons and no salon chosen a day is closed only when every salon of the reach closes it", async () => {
    const all = await week(t2.adminToken, W1);
    expect(day(all, "2026-06-21").closed).toBe(true); // Sunday: both close
    expect(day(all, "2026-06-21").coverageStatus).toBe("ok");
    expect(day(all, "2026-06-20").closed).toBe(false); // Saturday: only A closes
    const a = await week(t2.adminToken, `${W1}&salonId=${salonA.id}`);
    expect(day(a, "2026-06-20").closed).toBe(true);
    expect(day(a, "2026-06-20").coverageStatus).toBe("ok");
    const b = await week(t2.adminToken, `${W1}&salonId=${salonB.id}`);
    expect(day(b, "2026-06-20").closed).toBe(false);
  });

  // ── D-589-04 under a salon filter and for a scoped caller ───────────────────────────────
  it("(i) under a salon filter contract presence needs the Stammsalon, and a shift anywhere replaces it", async () => {
    const a = await week(t2.adminToken, `${W1}&salonId=${salonA.id}`);
    expect(day(a, "2026-06-15").effectiveStaff).toBe(1); // PA only (Stammsalon A)
    expect(day(a, "2026-06-16").effectiveStaff).toBe(0); // PA works in B that day
    const b = await week(t2.adminToken, `${W1}&salonId=${salonB.id}`);
    expect(day(b, "2026-06-15").effectiveStaff).toBe(2); // PB, DD (Stammsalon B; PA's Stammsalon is A)
    expect(day(b, "2026-06-16").effectiveStaff).toBe(3); // PB, DD + PA's shift in B
    const all = await week(t2.adminToken, W1);
    // T2's seeded admin and employee have no Stammsalon and count unfiltered.
    expect(day(all, "2026-06-15").effectiveStaff).toBe(5); // admin, employee, PA, PB, DD
    expect(day(all, "2026-06-16").effectiveStaff).toBe(5); // PA by shift instead of contract
  });

  it("(j) a scoped caller never counts a person whose leave it cannot read", async () => {
    const b = await week(managerToken, W1);
    const ids = b.employees.map((e) => e.id);
    expect(ids).toContain(dd); // listed through the deployment in A
    expect(ids).toContain(pa);
    for (const c of b.coverage) expect(c.contractEmployeeIds).not.toContain(dd);
    // Wednesday: DD is on approved leave (not readable here, Stammsalon B); only PA counts.
    expect(day(b, "2026-06-17").effectiveStaff).toBe(1);
    expect(day(b, "2026-06-17").contractEmployeeIds).toEqual([pa]);
    // The whole-tenant admin reads DD's leave, so DD is simply on leave that day.
    const admin = await week(t2.adminToken, W1);
    expect(day(admin, "2026-06-17").contractEmployeeIds).not.toContain(dd);
  });

  // ── D-589-07: the contract-day hint source ──────────────────────────────────────────────
  it("(k) contractWorkDaysByEmp lists the contract workdays of fixed/flex persons only", async () => {
    const b = await week(t1.adminToken, W1);
    expect(b.contractWorkDaysByEmp[f2]).toEqual([
      "2026-06-16",
      "2026-06-17",
      "2026-06-18",
      "2026-06-19",
      "2026-06-20",
    ]);
    expect(b.contractWorkDaysByEmp[f1]).toEqual([
      "2026-06-15",
      "2026-06-16",
      "2026-06-17",
      "2026-06-18",
      "2026-06-19",
    ]);
    for (const id of [s1, s2, m1]) expect(b.contractWorkDaysByEmp[id]).toBeUndefined();
  });

  it("(k2) a work-location holiday leaves the contract day list and the count", async () => {
    const holiday = await app.prisma.publicHoliday.create({
      data: {
        tenantId: t1.tenant.id,
        salonId: t1.salonId,
        date: new Date("2026-06-19T00:00:00Z"),
        name: "Rost589 Feiertag",
        federalState: "NIEDERSACHSEN",
        year: 2026,
      },
    });
    try {
      const b = await week(t1.adminToken, W1);
      expect(b.contractWorkDaysByEmp[f1]).toEqual([
        "2026-06-15",
        "2026-06-16",
        "2026-06-17",
        "2026-06-18",
      ]);
      expect(day(b, "2026-06-19").contractEmployeeIds).not.toContain(f1);
      expect(day(b, "2026-06-19").effectiveStaff).toBe(0);
    } finally {
      await app.prisma.publicHoliday.delete({ where: { id: holiday.id } });
    }
  });

  // ── D-589-05 / AC-589-4: counted persons are roster rows (cross-layer) ──────────────────
  it("(counted ⊆ rows) every person counted in coverage is a row of the web roster", async () => {
    // The web helper is a pure module; it is loaded by path so the API build (rootDir src) never
    // follows the import.
    const modulePath = path.resolve(
      __dirname,
      "../../../web/src/lib/shifts/roster-rows.ts",
    ) as string;
    const { rosterRows } = (await import(/* @vite-ignore */ modulePath)) as {
      rosterRows: (w: WeekBody) => Array<{ id: string }>;
    };
    expect(typeof rosterRows).toBe("function");
    const probes: Array<[string, string, WeekBody]> = [
      ["T1 W1", "t1", await week(t1.adminToken, W1)],
      ["T1 W2", "t1", await week(t1.adminToken, W2)],
      ["T2 W1", "t2", await week(t2.adminToken, W1)],
      ["T2 A", "t2", await week(t2.adminToken, `${W1}&salonId=${salonA.id}`)],
      ["T2 B", "t2", await week(t2.adminToken, `${W1}&salonId=${salonB.id}`)],
      ["T2 mgr", "t2", await week(managerToken, W1)],
    ];
    for (const [label, , body] of probes) {
      const rowIds = new Set(rosterRows(body).map((e) => e.id));
      expect(rowIds.size, label).toBeGreaterThan(0);
      const counted = new Set<string>();
      for (const c of body.coverage) for (const id of c.contractEmployeeIds) counted.add(id);
      for (const s of body.shifts) {
        // A shift counts only for a listed employee (empById); mirror that rule for the check.
        if (body.employees.some((e) => e.id === s.employeeId)) counted.add(s.employeeId);
      }
      expect(counted.size, label).toBeGreaterThan(0);
      for (const id of counted) expect(rowIds.has(id), `${label}: ${id}`).toBe(true);
    }
  });

  // ── D-589-02: every model can receive a shift ───────────────────────────────────────────
  it("(f) POST /shifts accepts any contract model and refuses a date without a contract", async () => {
    const post = (employeeId: string, date: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/shifts",
        headers: { authorization: `Bearer ${t1.adminToken}` },
        payload: { employeeId, date, startTime: "08:00", endTime: "16:00" },
      });
    const r1 = await post(f1, "2099-06-02");
    expect(r1.statusCode, r1.body).toBe(201);
    const r2 = await post(m1, "2099-06-03");
    expect(r2.statusCode, r2.body).toBe(201);
    const r3 = await post(noContract, "2099-06-04");
    expect(r3.statusCode).toBe(422);
    expect(JSON.parse(r3.body).code).toBe("SHIFT_NO_CONTRACT");

    const s2shift = await post(s2, "2099-06-05");
    expect(s2shift.statusCode, s2shift.body).toBe(201);
    const moved = await app.inject({
      method: "PUT",
      url: `/api/v1/shifts/${(JSON.parse(s2shift.body) as { id: string }).id}`,
      headers: { authorization: `Bearer ${t1.adminToken}` },
      payload: { employeeId: f1, date: "2099-06-05" },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const refused = await app.inject({
      method: "PUT",
      url: `/api/v1/shifts/${(JSON.parse(s2shift.body) as { id: string }).id}`,
      headers: { authorization: `Bearer ${t1.adminToken}` },
      payload: { employeeId: noContract, date: "2099-06-05" },
    });
    expect(refused.statusCode).toBe(422);
    expect(JSON.parse(refused.body).code).toBe("SHIFT_NO_CONTRACT");
  });

  // ── OD-589-2: Soll stays SHIFT_BASED-only ───────────────────────────────────────────────
  it("(g) contractSollMinutesByEmp holds keys only for SHIFT_BASED persons", async () => {
    const b = await week(t1.adminToken, W1);
    expect(Object.keys(b.contractSollMinutesByEmp ?? {}).sort()).toEqual([s1, s2].sort());
  });
});
