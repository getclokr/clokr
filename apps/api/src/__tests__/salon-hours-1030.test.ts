/**
 * Issue #1030 - `GET /api/v1/salon-hours`: the Salonansicht as an hours raster Person x day for one
 * salon over a week or a calendar month.
 *
 * World (`Date` faked to Wednesday 2026-03-18T10:00Z, tenant Europe/Berlin, so tenant-local yesterday
 * is Tuesday 2026-03-17; salons A = the seed's salon, B, C active, D inactive; a foreign tenant has its
 * own salon):
 *
 *   tag | Stammsalon | what is recorded (all closed WORK, 08:00 start)
 *   ----+------------+-------------------------------------------------------------------------------
 *   P1  | A          | A: Mon 9.3. 8 h, Tue 10.3. 4 h, Mon 16.3. 8 h, Tue 17.3. 6 h, TODAY 18.3. 8 h,
 *       |            |    Fri 20.3. 8 h (future), Thu 5.3. 3 h (earlier in the month)
 *   P2  | A          | A: Mon 9.3. 6 h; an OPEN entry in A on Wed 11.3.; an INVALID entry in A 12.3.
 *   Q1  | B          | A: Wed 11.3. 4 h (a helper in A)
 *   TR  | A          | a TRAVEL row A -> B on Fri 6.3. 12:00-13:00 (counts for the departure salon A)
 *   MV  | A until 4.3., B from 5.3. | A: Mon 2.3. 3 h (before the move), B: Thu 5.3. 4 h
 *   NH  | no HOME row | A: Tue 3.3. 2 h (a helper without a Stammsalon)
 *   P1  | (also)     | VACATION approved Mon 2.3. - Tue 3.3.; P2: B Tue 3.3. 5 h, Absence Berufsschule Wed 4.3.
 *
 * No person names beyond the fixture tags. Mutation proofs are recorded in the plan SUMMARY.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
  createTestSalon,
  reissueTokenNow,
  numericEmployeeNumber,
} from "./setup";
import { createPopulationPerson } from "./population-fixtures-613";
import { SYSTEM_ROLE_IDS, salonOnlyReach } from "../contexts/platform";
import { monthRangeUtc, monthDateRange } from "../contexts/working-time-account";
import { resolvePeriodReachIds, resolveWindowReachIds } from "../composition/reach-day";
import { salonWorkedMinutesOf } from "../composition/reports-period";
import { absentDaysOf } from "../composition/salon-hours-cells";

const FAKE_NOW = "2026-03-18T10:00:00.000Z";
const NOT_FOUND = '{"error":"Salon nicht gefunden"}';
const PASSWORD = "test1234";

type Cell = {
  date: string;
  minutes: number;
  counted: boolean;
  elsewhere: Array<{ salonId: string; salonName: string }>;
  elsewhereHidden: boolean;
  absent: boolean;
};
type Row = {
  employeeId: string;
  employeeName: string;
  employeeNumber: string | null;
  totalMinutes: number;
  cells: Cell[];
};
type HelperRow = Row & { homeSalonId: string | null; homeSalonName: string | null };
type Block = { rows: Row[]; dayTotals: number[]; totalMinutes: number };
type HelperBlock = { rows: HelperRow[]; dayTotals: number[]; totalMinutes: number };
type Hours = {
  salonId: string;
  salonName: string;
  period: "week" | "month";
  from: string;
  to: string;
  days: string[];
  countedThrough: string | null;
  kpis: { salonWorkedMinutes: number; stammteamMinutes: number; aushilfenMinutes: number };
  stammteam: Block;
  aushilfen: HelperBlock;
};

type Tag = "P1" | "P2" | "Q1" | "TR" | "MV" | "NH";

describe("Issue #1030 - GET /salon-hours, the Stammteam raster", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let foreign: Awaited<ReturnType<typeof seedTestData>>;
  let salonA: string;
  let salonB: string;
  let salonC: string;
  let salonD: string;
  let tenantId: string;
  const ids = {} as Record<Tag, string>;
  const tokens = { admin: "", emp: "", managerA: "", managerB: "" };
  let managerAEmail = "";

  function entry(
    employeeId: string,
    salonId: string,
    date: string,
    opts: {
      hours?: number;
      endTime?: Date | null;
      isInvalid?: boolean;
      breakMinutes?: number;
    } = {},
  ) {
    const hours = opts.hours ?? 8;
    const end =
      opts.endTime === undefined
        ? new Date(`${date}T${String(8 + hours).padStart(2, "0")}:00:00Z`)
        : opts.endTime;
    return app.prisma.timeEntry.create({
      data: {
        employeeId,
        salonId,
        date: new Date(`${date}T00:00:00Z`),
        startTime: new Date(`${date}T08:00:00Z`),
        endTime: end,
        breakMinutes: opts.breakMinutes ?? 0,
        isInvalid: opts.isInvalid ?? false,
        type: "WORK",
        source: "MANUAL",
      },
    });
  }

  async function get(query: string, token = tokens.admin) {
    return app.inject({
      method: "GET",
      url: `/api/v1/salon-hours?${query}`,
      headers: { authorization: `Bearer ${token}` },
    });
  }
  async function hours(query: string, token = tokens.admin): Promise<Hours> {
    const res = await get(query, token);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as Hours;
  }
  const rowOf = (h: Hours, tag: Tag): Row => {
    const row = h.stammteam.rows.find((r) => r.employeeId === ids[tag]);
    if (!row) throw new Error(`row ${tag} missing`);
    return row;
  };
  const cellOf = (row: Row, date: string): Cell => {
    const cell = row.cells.find((c) => c.date === date);
    if (!cell) throw new Error(`cell ${date} missing`);
    return cell;
  };

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FAKE_NOW));
    app = await getTestApp();
    data = await seedTestData(app, "sh1030");
    foreign = await seedTestData(app, "sh1030f");
    tenantId = data.tenant.id;
    salonA = data.salonId;
    salonB = (await createTestSalon(app.prisma, tenantId, { name: "SH1030 B" })).id;
    salonC = (await createTestSalon(app.prisma, tenantId, { name: "SH1030 C" })).id;
    salonD = (await createTestSalon(app.prisma, tenantId, { name: "SH1030 D", isActive: false }))
      .id;
    tokens.admin = data.adminToken;
    tokens.emp = data.empToken;

    const old = new Date("2025-06-01T00:00:00Z");
    const mk = async (tag: Tag, salonId: string) => {
      const p = await createPopulationPerson(app, { tenantId, salonId, tag, hireDate: old });
      ids[tag] = p.employeeId;
    };
    await mk("P1", salonA);
    await mk("P2", salonA);
    await mk("Q1", salonB);
    await mk("TR", salonA);
    await mk("MV", salonA);
    await mk("NH", salonA);

    await entry(ids.P1, salonA, "2026-03-05", { hours: 3 });
    await entry(ids.P1, salonA, "2026-03-09");
    await entry(ids.P1, salonA, "2026-03-10", { hours: 4 });
    await entry(ids.P1, salonA, "2026-03-16");
    await entry(ids.P1, salonA, "2026-03-17", { hours: 6 });
    await entry(ids.P1, salonA, "2026-03-18"); // today: counts nowhere
    await entry(ids.P1, salonA, "2026-03-20"); // after today
    await entry(ids.P2, salonA, "2026-03-09", { hours: 6 });
    await entry(ids.P2, salonA, "2026-03-11", { endTime: null });
    await entry(ids.P2, salonA, "2026-03-12", { isInvalid: true });
    await entry(ids.Q1, salonA, "2026-03-11", { hours: 4 });

    // Week 2.-8.3.: the mover MV is homed in A until 4.3. and in B from 5.3.; NH has no Stammsalon.
    await app.prisma.employeeSalonAssignment.updateMany({
      where: { employeeId: ids.MV, kind: "HOME" },
      data: { validUntil: new Date("2026-03-04T00:00:00Z") },
    });
    await app.prisma.employeeSalonAssignment.create({
      data: {
        tenantId,
        employeeId: ids.MV,
        salonId: salonB,
        kind: "HOME",
        validFrom: new Date("2026-03-05T00:00:00Z"),
        validUntil: null,
        weekdays: [],
      },
    });
    await app.prisma.employeeSalonAssignment.deleteMany({ where: { employeeId: ids.NH } });
    await entry(ids.MV, salonA, "2026-03-02", { hours: 3 });
    await entry(ids.MV, salonB, "2026-03-05", { hours: 4 });
    await entry(ids.NH, salonA, "2026-03-03", { hours: 2 });
    await entry(ids.P2, salonB, "2026-03-03", { hours: 5 });
    // A trip A -> B: the departure salon A is the one it counts for (#92).
    await app.prisma.timeEntry.create({
      data: {
        employeeId: ids.TR,
        salonId: salonA,
        travelToSalonId: salonB,
        activityKind: "TRAVEL",
        date: new Date("2026-03-06T00:00:00Z"),
        startTime: new Date("2026-03-06T12:00:00Z"),
        endTime: new Date("2026-03-06T13:00:00Z"),
        breakMinutes: 0,
        type: "WORK",
        source: "MANUAL",
      },
    });
    // Effective leave and an imposed absence on days the person is homed in A.
    await app.prisma.leaveRequest.create({
      data: {
        employeeId: ids.P1,
        leaveTypeId: data.vacationType.id,
        startDate: new Date("2026-03-02T00:00:00Z"),
        endDate: new Date("2026-03-03T00:00:00Z"),
        days: 2,
        status: "APPROVED",
      },
    });
    await app.prisma.absence.create({
      data: {
        employeeId: ids.P2,
        type: "VOCATIONAL_SCHOOL",
        startDate: new Date("2026-03-04T00:00:00Z"),
        endDate: new Date("2026-03-04T00:00:00Z"),
        days: 1,
        createdBy: data.adminUser.id,
      },
    });

    // A Salonmanager of salon A only, and (through the seed) the whole-tenant admin.
    const user = await app.prisma.user.create({
      data: {
        email: `mgr-1030-${Date.now().toString(36)}@example.invalid`,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        isActive: true,
      },
    });
    await app.prisma.employee.create({
      data: {
        tenantId,
        userId: user.id,
        employeeNumber: numericEmployeeNumber(),
        firstName: "Mg",
        lastName: "Mgr1030",
        hireDate: old,
      },
    });
    await app.prisma.roleAssignment.create({
      data: {
        tenantId,
        userId: user.id,
        accessRoleId: SYSTEM_ROLE_IDS.SALON_MANAGER,
        scopeType: "SALONS",
        salonIds: [salonA],
        employeeIds: [],
      },
    });
    managerAEmail = user.email;
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: managerAEmail, password: PASSWORD },
    });
    expect(login.statusCode, login.body).toBe(200);
    tokens.managerA = (JSON.parse(login.body) as { accessToken: string }).accessToken;
    tokens.managerB = await salonManager("B", [salonB]);
  });

  async function salonManager(label: string, salonIds: string[]): Promise<string> {
    const user = await app.prisma.user.create({
      data: {
        email: `mgr-1030-${label}-${Date.now().toString(36)}@example.invalid`,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        isActive: true,
      },
    });
    await app.prisma.employee.create({
      data: {
        tenantId,
        userId: user.id,
        employeeNumber: numericEmployeeNumber(),
        firstName: "Mg",
        lastName: `Mgr1030${label}`,
        hireDate: new Date("2025-06-01T00:00:00Z"),
      },
    });
    await app.prisma.roleAssignment.create({
      data: {
        tenantId,
        userId: user.id,
        accessRoleId: SYSTEM_ROLE_IDS.SALON_MANAGER,
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

  afterAll(async () => {
    vi.useRealTimers();
    try {
      await app.prisma.roleAssignment.deleteMany({ where: { tenantId } });
      await cleanupTestData(app, tenantId);
      await cleanupTestData(app, foreign.tenant.id);
    } catch (err) {
      console.error("salon-hours-1030 cleanup failed:", err);
    }
    await closeTestApp();
  });

  // ── the week raster ───────────────────────────────────────────────────────────────────────

  it("without a date the default week is the week of tenant-local yesterday, counted through yesterday", async () => {
    const h = await hours(`salonId=${salonA}`);
    expect(h.period).toBe("week");
    expect(h.days).toEqual([
      "2026-03-16",
      "2026-03-17",
      "2026-03-18",
      "2026-03-19",
      "2026-03-20",
      "2026-03-21",
      "2026-03-22",
    ]);
    expect(h.from).toBe("2026-03-16");
    expect(h.to).toBe("2026-03-22");
    expect(h.countedThrough).toBe("2026-03-17");
    expect(h.salonId).toBe(salonA);
    expect(h.salonName).toBe(data.tenant.name);
  });

  it("cells hold the minutes worked in this salon; today, a future day, open and invalid rows count nowhere", async () => {
    const h = await hours(`salonId=${salonA}`);
    const p1 = rowOf(h, "P1");
    expect(cellOf(p1, "2026-03-16")).toMatchObject({ minutes: 480, counted: true });
    expect(cellOf(p1, "2026-03-17")).toMatchObject({ minutes: 360, counted: true });
    // Today has a closed 8 h entry in the database and still reads as not counted.
    expect(cellOf(p1, "2026-03-18")).toMatchObject({ minutes: 0, counted: false });
    expect(cellOf(p1, "2026-03-20")).toMatchObject({ minutes: 0, counted: false });
    expect(p1.totalMinutes).toBe(840);
    expect(p1.totalMinutes).toBeGreaterThan(0);
  });

  it("a cell is exactly salonWorkedMinutesOf of that day's rows (the one minutes derivation)", async () => {
    const past = await hours(`salonId=${salonA}&period=week&date=2026-03-10`);
    const p1 = rowOf(past, "P1");
    const rows = await app.prisma.timeEntry.findMany({
      where: { employeeId: ids.P1, deletedAt: null, date: new Date("2026-03-09T00:00:00Z") },
    });
    const expected = salonWorkedMinutesOf(rows, salonA, new Date("2026-03-17T00:00:00Z"));
    expect(expected).toBeGreaterThan(0);
    expect(cellOf(p1, "2026-03-09").minutes).toBe(expected);
  });

  it("a past week is counted through its last day and the totals add up", async () => {
    const h = await hours(`salonId=${salonA}&period=week&date=2026-03-11`);
    expect(h.from).toBe("2026-03-09");
    expect(h.to).toBe("2026-03-15");
    expect(h.countedThrough).toBe("2026-03-15");
    const p1 = rowOf(h, "P1");
    const p2 = rowOf(h, "P2");
    expect(p1.cells.map((c) => c.minutes)).toEqual([480, 240, 0, 0, 0, 0, 0]);
    // P2: the 6 h of Monday; the open Wednesday row and the invalid Thursday row are no minutes.
    expect(p2.cells.map((c) => c.minutes)).toEqual([360, 0, 0, 0, 0, 0, 0]);
    expect(p1.totalMinutes).toBe(p1.cells.reduce((s, c) => s + c.minutes, 0));
    for (let i = 0; i < h.days.length; i++) {
      expect(h.stammteam.dayTotals[i]).toBe(
        h.stammteam.rows.reduce((sum, r) => sum + r.cells[i].minutes, 0),
      );
    }
    expect(h.stammteam.totalMinutes).toBe(1080);
    expect(h.stammteam.totalMinutes).toBe(h.stammteam.rows.reduce((s, r) => s + r.totalMinutes, 0));
    expect(h.kpis.stammteamMinutes).toBe(1080);
    // Q1 helped in A on Wed 11.3. for 4 h: the KPI is the Stammteam plus the Aushilfen.
    expect(h.kpis.aushilfenMinutes).toBe(240);
    expect(h.kpis.salonWorkedMinutes).toBe(1080 + 240);
  });

  it("the Stammteam holds the persons homed in the salon, never another salon's person", async () => {
    const h = await hours(`salonId=${salonA}&period=week&date=2026-03-11`);
    const rowIds = h.stammteam.rows.map((r) => r.employeeId);
    expect(rowIds).toContain(ids.P1);
    expect(rowIds).toContain(ids.P2);
    // Q1 is homed in B; in A they are at most a helper (Task 2), never a Stammteam row.
    expect(rowIds).not.toContain(ids.Q1);
    const other = await hours(`salonId=${salonB}&period=week&date=2026-03-11`);
    // B's Stammteam at the week's Stichtag (15.3.): Q1 and the mover MV (homed in B from 5.3.).
    expect(other.stammteam.rows.map((r) => r.employeeId).sort()).toEqual([ids.Q1, ids.MV].sort());
    // Q1's hours in salon A are not hours of salon B.
    expect(other.stammteam.totalMinutes).toBe(0);
  });

  it("a window that starts today has nothing counted yet", async () => {
    vi.setSystemTime(new Date("2026-03-23T10:00:00.000Z"));
    try {
      const token = reissueTokenNow(app, tokens.admin);
      const starts = await hours(`salonId=${salonA}&period=week&date=2026-03-23`, token);
      expect(starts.from).toBe("2026-03-23");
      expect(starts.countedThrough).toBeNull();
      expect(starts.stammteam.rows.every((r) => r.cells.every((c) => !c.counted))).toBe(true);
      // Without a date the anchor is yesterday (Sunday): the whole week before is counted.
      const dflt = await hours(`salonId=${salonA}`, token);
      expect(dflt.from).toBe("2026-03-16");
      expect(dflt.countedThrough).toBe("2026-03-22");
    } finally {
      vi.setSystemTime(new Date(FAKE_NOW));
    }
  });

  // ── the month raster ──────────────────────────────────────────────────────────────────────

  it("period=month answers every day of the calendar month, counted through yesterday", async () => {
    const h = await hours(`salonId=${salonA}&period=month&date=2026-03-10`);
    expect(h.period).toBe("month");
    expect(h.days).toHaveLength(31);
    expect(h.days[0]).toBe("2026-03-01");
    expect(h.days[30]).toBe("2026-03-31");
    expect(h.from).toBe("2026-03-01");
    expect(h.to).toBe("2026-03-31");
    expect(h.countedThrough).toBe("2026-03-17");
    const p1 = rowOf(h, "P1");
    // 5.3. 3 h + 9.3. 8 h + 10.3. 4 h + 16.3. 8 h + 17.3. 6 h; today and the 20th are not counted.
    expect(p1.totalMinutes).toBe((3 + 8 + 4 + 8 + 6) * 60);
    expect(h.kpis.salonWorkedMinutes).toBe(h.stammteam.totalMinutes + h.aushilfen.totalMinutes);
  });

  it("the week raster is the same figures as the same days of the month raster", async () => {
    const week = await hours(`salonId=${salonA}&period=week&date=2026-03-11`);
    const month = await hours(`salonId=${salonA}&period=month&date=2026-03-11`);
    for (const tag of ["P1", "P2"] as const) {
      const weekRow = rowOf(week, tag);
      const monthRow = rowOf(month, tag);
      for (const cell of weekRow.cells) {
        expect(cellOf(monthRow, cell.date).minutes).toBe(cell.minutes);
      }
    }
  });

  // ── the one 404, the 400s, the permission ─────────────────────────────────────────────────

  it("a foreign tenant's salon, an unknown id, an inactive salon and a salon outside the reach answer the byte-identical 404", async () => {
    const bodies: string[] = [];
    for (const [salon, token] of [
      [foreign.salonId, tokens.admin],
      ["00000000-0000-4000-8000-0000000000aa", tokens.admin],
      [salonD, tokens.admin],
      [salonB, tokens.managerA],
      [salonC, tokens.managerA],
    ] as const) {
      const res = await get(`salonId=${salon}`, token);
      expect(res.statusCode, `${salon}: ${res.body}`).toBe(404);
      bodies.push(res.body);
    }
    for (const body of bodies) expect(body).toBe(NOT_FOUND);
  });

  it("the Salonmanager of A reads salon A", async () => {
    const h = await hours(`salonId=${salonA}&period=week&date=2026-03-11`, tokens.managerA);
    expect(h.stammteam.rows.map((r) => r.employeeId)).toEqual(
      expect.arrayContaining([ids.P1, ids.P2]),
    );
    expect(rowOf(h, "P1").totalMinutes).toBe(720);
  });

  it("a plain employee gets 403", async () => {
    const res = await get(`salonId=${salonA}`, tokens.emp);
    expect(res.statusCode).toBe(403);
  });

  it("answers 400 for a window after today, a malformed salon id or date, and a missing salon id", async () => {
    const future = await get(`salonId=${salonA}&period=week&date=2026-04-20`);
    expect(future.statusCode).toBe(400);
    expect(JSON.parse(future.body)).toEqual({
      error: "Der Zeitraum darf nicht in der Zukunft liegen.",
    });
    expect((await get(`salonId=not-a-uuid`)).statusCode).toBe(400);
    expect((await get(`salonId=${salonA}&date=2026-02-31`)).statusCode).toBe(400);
    expect((await get(`salonId=${salonA}&date=18.03.2026`)).statusCode).toBe(400);
    expect((await get(``)).statusCode).toBe(400);
    expect((await get(`salonId=${salonA}&period=year`)).statusCode).toBe(400);
  });

  // ── what the answer never carries ─────────────────────────────────────────────────────────

  it("carries no key naming a Soll, saldo, balance, overtime or expected figure", async () => {
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
      } else if (value !== null && typeof value === "object") {
        for (const [key, inner] of Object.entries(value)) {
          keys.add(key);
          walk(inner);
        }
      }
    };
    walk(await hours(`salonId=${salonA}&period=week&date=2026-03-11`));
    walk(await hours(`salonId=${salonA}&period=month`));
    expect(keys.size).toBeGreaterThan(10);
    for (const key of keys) expect(key).not.toMatch(/soll|saldo|balance|overtime|expected|should/i);
  });

  // ── the reach-day generalisation ──────────────────────────────────────────────────────────

  it("resolveWindowReachIds over a whole-month window equals resolvePeriodReachIds for that month", async () => {
    const tz = "Europe/Berlin";
    const { start, end } = monthRangeUtc(2026, 3, tz);
    const { lastDay } = monthDateRange(2026, 3, tz);
    const reach = salonOnlyReach(salonA);
    const viaWindow = await resolveWindowReachIds(
      app.prisma,
      tenantId,
      reach,
      { start, end, lastDay },
      tz,
    );
    const viaPeriod = await resolvePeriodReachIds(
      app.prisma,
      tenantId,
      reach,
      { year: 2026, month: 3 },
      { year: 2026, month: 3 },
      tz,
    );
    expect(viaWindow).not.toBe("all");
    expect((viaWindow as string[]).length).toBeGreaterThanOrEqual(2);
    expect([...(viaWindow as string[])].sort()).toEqual([...(viaPeriod as string[])].sort());
  });

  // ── Task 2: Aushilfen, cell states, parity, redaction ─────────────────────────────────────

  const helperOf = (h: Hours, tag: Tag): HelperRow => {
    const row = h.aushilfen.rows.find((r) => r.employeeId === ids[tag]);
    if (!row) throw new Error(`helper ${tag} missing`);
    return row;
  };
  const WEEK2 = "period=week&date=2026-03-04";

  it("a person of another salon with a counted entry here is an Aushilfe with the Stammsalon, never a Stammteam row", async () => {
    const h = await hours(`salonId=${salonA}&period=week&date=2026-03-11`);
    const q1 = helperOf(h, "Q1");
    expect(q1.homeSalonId).toBe(salonB);
    expect(q1.homeSalonName).toBe("SH1030 B");
    expect(q1.totalMinutes).toBe(240);
    expect(cellOf(q1, "2026-03-11").minutes).toBe(240);
    expect(h.stammteam.rows.map((r) => r.employeeId)).not.toContain(ids.Q1);
    // The helper block sums its own rows; the KPI sums both blocks.
    expect(h.aushilfen.totalMinutes).toBe(240);
    expect(h.aushilfen.dayTotals[2]).toBe(240);
  });

  it("an Aushilfe without a Stammsalon has homeSalonId null", async () => {
    const h = await hours(`salonId=${salonA}&${WEEK2}`);
    const nh = helperOf(h, "NH");
    expect(nh.homeSalonId).toBeNull();
    expect(nh.homeSalonName).toBeNull();
    expect(nh.totalMinutes).toBe(120);
  });

  it("a mover is judged on the window's Stichtag: a helper in A, a Stammteam row in B", async () => {
    const a = await hours(`salonId=${salonA}&${WEEK2}`);
    const mvInA = helperOf(a, "MV");
    expect(mvInA.homeSalonId).toBe(salonB);
    expect(mvInA.totalMinutes).toBe(180);
    expect(a.stammteam.rows.map((r) => r.employeeId)).not.toContain(ids.MV);
    const b = await hours(`salonId=${salonB}&${WEEK2}`);
    const mvInB = rowOf(b, "MV");
    // The 4 h of Thu 5.3. in B are B's hours; the 3 h of Mon 2.3. in A are not.
    expect(mvInB.totalMinutes).toBe(240);
    expect(cellOf(mvInB, "2026-03-05").minutes).toBe(240);
    expect(cellOf(mvInB, "2026-03-02").minutes).toBe(0);
    expect(b.aushilfen.rows.map((r) => r.employeeId)).not.toContain(ids.MV);
  });

  it("the KPI is the Stammteam plus the Aushilfen, and a trip counts for its departure salon", async () => {
    const a = await hours(`salonId=${salonA}&${WEEK2}`);
    expect(a.kpis.salonWorkedMinutes).toBe(a.stammteam.totalMinutes + a.aushilfen.totalMinutes);
    expect(a.kpis.aushilfenMinutes).toBe(a.aushilfen.totalMinutes);
    expect(a.aushilfen.totalMinutes).toBeGreaterThan(0);
    // TR's only row is the A -> B trip: 60 minutes in A on Fri 6.3., none anywhere in B.
    expect(cellOf(rowOf(a, "TR"), "2026-03-06").minutes).toBe(60);
    const b = await hours(`salonId=${salonB}&${WEEK2}`);
    expect(b.stammteam.rows.map((r) => r.employeeId)).not.toContain(ids.TR);
    expect(b.aushilfen.rows.map((r) => r.employeeId)).not.toContain(ids.TR);
  });

  it("names another salon on a day of an A-homed person's time there (whole tenant and the manager of A)", async () => {
    for (const token of [tokens.admin, tokens.managerA]) {
      const a = await hours(`salonId=${salonA}&${WEEK2}`, token);
      const cell = cellOf(rowOf(a, "P2"), "2026-03-03");
      expect(cell.minutes).toBe(0);
      expect(cell.elsewhere).toEqual([{ salonId: salonB, salonName: "SH1030 B" }]);
      expect(cell.elsewhereHidden).toBe(false);
    }
  });

  it("reads time outside the reach as a neutral hidden mark without minutes, salon id or salon name", async () => {
    const b = await get(`salonId=${salonB}&${WEEK2}`, tokens.managerB);
    expect(b.statusCode, b.body).toBe(200);
    const answer = JSON.parse(b.body) as Hours;
    const mv = rowOf(answer, "MV");
    // Mon 2.3.: MV was homed in A and worked in A - outside the manager of B's reach.
    const hidden = cellOf(mv, "2026-03-02");
    expect(hidden.elsewhereHidden).toBe(true);
    expect(hidden.minutes).toBe(0);
    expect(hidden.elsewhere).toEqual([]);
    // MV's own in-reach hours stay.
    expect(mv.totalMinutes).toBe(240);
    // No cell of the answer names salon A as a place of time: out-of-reach time carries no salon. (A
    // helper's Stammsalon is master data of a person who worked in B and stays named, see #949.)
    const named = [...answer.stammteam.rows, ...answer.aushilfen.rows].flatMap((r) =>
      r.cells.flatMap((c) => c.elsewhere.map((e) => e.salonId)),
    );
    expect(named).not.toContain(salonA);
    const hiddenCells = [...answer.stammteam.rows, ...answer.aushilfen.rows].flatMap((r) =>
      r.cells.filter((c) => c.elsewhereHidden),
    );
    expect(hiddenCells.length).toBeGreaterThan(0);
    expect(hiddenCells.every((c) => c.minutes === 0 && c.elsewhere.length === 0)).toBe(true);
    // The whole-tenant caller names the salon on the same cell.
    const whole = await hours(`salonId=${salonB}&${WEEK2}`);
    expect(cellOf(rowOf(whole, "MV"), "2026-03-02")).toMatchObject({
      elsewhereHidden: false,
      elsewhere: [{ salonId: salonA, salonName: data.tenant.name }],
    });
  });

  it("marks leave and an imposed absence as absent without any kind, only for Stammteam persons on days homed here", async () => {
    const a = await get(`salonId=${salonA}&${WEEK2}`);
    const answer = JSON.parse(a.body) as Hours;
    expect(cellOf(rowOf(answer, "P1"), "2026-03-02").absent).toBe(true);
    expect(cellOf(rowOf(answer, "P1"), "2026-03-03").absent).toBe(true);
    expect(cellOf(rowOf(answer, "P1"), "2026-03-04").absent).toBe(false);
    expect(cellOf(rowOf(answer, "P2"), "2026-03-04").absent).toBe(true);
    // No kind, reason or name of an absence anywhere in the answer.
    for (const word of [
      "VACATION",
      "VOCATIONAL_SCHOOL",
      "SICK",
      "Urlaub",
      "Berufsschule",
      "Krankheit",
      "halfDay",
      "reason",
      data.vacationType.name,
    ]) {
      expect(a.body, word).not.toContain(word);
    }
    // A helper is never absent; the Stammsalon holds their absences.
    for (const row of answer.aushilfen.rows) expect(row.cells.every((c) => !c.absent)).toBe(true);
  });

  it("shows no absence on days a person is homed in another salon (the mover's days in A)", async () => {
    // MV is homed in A until 4.3.; leave on 2.3. would be absent in A's week - none is recorded, so
    // the helper-free Stammteam day map is the proof here: absentDaysOf is the only rule.
    const day = "2026-03-02";
    const home = new Map([[ids.MV, new Map([[day, salonB]])]]);
    const covers = [
      {
        employeeId: ids.MV,
        startDate: new Date(`${day}T00:00:00Z`),
        endDate: new Date(`${day}T00:00:00Z`),
      },
    ];
    expect(
      absentDaysOf({
        salonId: salonA,
        days: [day],
        personIds: [ids.MV],
        homeByPerson: home,
        covers,
      }).size,
    ).toBe(0);
  });

  it("withholds a helper's Personalnummer from a scoped manager and shows it to the whole tenant", async () => {
    const week = "period=week&date=2026-03-11";
    const scoped = await hours(`salonId=${salonA}&${week}`, tokens.managerA);
    const whole = await hours(`salonId=${salonA}&${week}`);
    expect(helperOf(scoped, "Q1").employeeNumber).toBeNull();
    expect(typeof helperOf(whole, "Q1").employeeNumber).toBe("string");
    // Stammteam persons keep their number for the scoped manager.
    expect(typeof rowOf(scoped, "P1").employeeNumber).toBe("string");
  });

  it("the scoped manager of A sees no minute of an entry outside the reach", async () => {
    const week = await hours(`salonId=${salonA}&${WEEK2}`, tokens.managerA);
    // MV's B entry of Thu 5.3. is outside A's reach: it appears in no cell, no total, no KPI.
    const mv = helperOf(week, "MV");
    expect(mv.cells.map((c) => c.minutes)).toEqual([180, 0, 0, 0, 0, 0, 0]);
    expect(week.kpis.salonWorkedMinutes).toBe(
      week.stammteam.totalMinutes + week.aushilfen.totalMinutes,
    );
    expect(week.aushilfen.rows.some((r) => r.employeeId === ids.MV && r.totalMinutes !== 180)).toBe(
      false,
    );
  });

  // ── parity with the period report (P-05) ──────────────────────────────────────────────────

  it("the month raster of a whole-tenant caller equals the salon view of GET /reports/period", async () => {
    type PeriodRow = { employeeId: string; salonWorkedMinutes?: number };
    type PeriodAnswer = {
      kpis: { salonWorkedMinutes: number };
      rows: PeriodRow[];
      helpers?: Array<{ employeeId: string; salonWorkedMinutes: number }>;
    };
    for (const salon of [salonA, salonB]) {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/reports/period?from=2026-03&to=2026-03&salonId=${salon}`,
        headers: { authorization: `Bearer ${tokens.admin}` },
      });
      expect(res.statusCode, res.body).toBe(200);
      const period = JSON.parse(res.body) as PeriodAnswer;
      const mine = await hours(`salonId=${salon}&period=month&date=2026-03-10`);

      expect(mine.stammteam.rows.map((r) => r.employeeId).sort()).toEqual(
        period.rows.map((r) => r.employeeId).sort(),
      );
      expect(mine.aushilfen.rows.map((r) => r.employeeId).sort()).toEqual(
        (period.helpers ?? []).map((h) => h.employeeId).sort(),
      );
      for (const row of mine.stammteam.rows) {
        const theirs = period.rows.find((r) => r.employeeId === row.employeeId);
        expect(row.totalMinutes, row.employeeId).toBe(theirs?.salonWorkedMinutes ?? 0);
      }
      for (const row of mine.aushilfen.rows) {
        const theirs = period.helpers?.find((h) => h.employeeId === row.employeeId);
        expect(row.totalMinutes, row.employeeId).toBe(theirs?.salonWorkedMinutes);
      }
      expect(mine.kpis.salonWorkedMinutes).toBe(period.kpis.salonWorkedMinutes);
      // Not vacuous: every compared figure is a real, positive number for salon A.
      if (salon === salonA) {
        expect(mine.kpis.salonWorkedMinutes).toBeGreaterThan(0);
        expect(mine.stammteam.rows.some((r) => r.totalMinutes > 0)).toBe(true);
        expect(mine.aushilfen.rows.some((r) => r.totalMinutes > 0)).toBe(true);
      }
    }
  });

  it("a week raster's person totals are the sums of the same days of the month raster", async () => {
    const week = await hours(`salonId=${salonA}&${WEEK2}`);
    const month = await hours(`salonId=${salonA}&period=month&date=2026-03-04`);
    const rowsOf = (h: Hours): Array<Row | HelperRow> => [...h.stammteam.rows, ...h.aushilfen.rows];
    for (const row of rowsOf(week)) {
      const inMonth = rowsOf(month).find((r) => r.employeeId === row.employeeId);
      expect(inMonth, row.employeeId).toBeDefined();
      const sameDays = inMonth!.cells
        .filter((c) => week.days.includes(c.date))
        .reduce((sum, c) => sum + c.minutes, 0);
      expect(row.totalMinutes).toBe(sameDays);
    }
    expect(rowsOf(week).some((r) => r.totalMinutes > 0)).toBe(true);
  });
});
