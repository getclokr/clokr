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
 *   Q1  | B          | A: Wed 11.3. 4 h (a helper, Task 2)
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

const FAKE_NOW = "2026-03-18T10:00:00.000Z";
const NOT_FOUND = '{"error":"Salon nicht gefunden"}';
const PASSWORD = "test1234";

type Cell = { date: string; minutes: number; counted: boolean };
type Row = {
  employeeId: string;
  employeeName: string;
  employeeNumber: string | null;
  totalMinutes: number;
  cells: Cell[];
};
type Block = { rows: Row[]; dayTotals: number[]; totalMinutes: number };
type Hours = {
  salonId: string;
  salonName: string;
  period: "week" | "month";
  from: string;
  to: string;
  days: string[];
  countedThrough: string | null;
  kpis: { salonWorkedMinutes: number; stammteamMinutes: number };
  stammteam: Block;
};

type Tag = "P1" | "P2" | "Q1";

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
  const tokens = { admin: "", emp: "", managerA: "" };
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
  });

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
    expect(cellOf(p1, "2026-03-16")).toEqual({ date: "2026-03-16", minutes: 480, counted: true });
    expect(cellOf(p1, "2026-03-17")).toEqual({ date: "2026-03-17", minutes: 360, counted: true });
    // Today has a closed 8 h entry in the database and still reads as not counted.
    expect(cellOf(p1, "2026-03-18")).toEqual({ date: "2026-03-18", minutes: 0, counted: false });
    expect(cellOf(p1, "2026-03-20")).toEqual({ date: "2026-03-20", minutes: 0, counted: false });
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
    expect(h.kpis.salonWorkedMinutes).toBe(1080);
    expect(h.kpis.stammteamMinutes).toBe(1080);
  });

  it("the Stammteam holds the persons homed in the salon, never another salon's person", async () => {
    const h = await hours(`salonId=${salonA}&period=week&date=2026-03-11`);
    const rowIds = h.stammteam.rows.map((r) => r.employeeId);
    expect(rowIds).toContain(ids.P1);
    expect(rowIds).toContain(ids.P2);
    // Q1 is homed in B; in A they are at most a helper (Task 2), never a Stammteam row.
    expect(rowIds).not.toContain(ids.Q1);
    const other = await hours(`salonId=${salonB}&period=week&date=2026-03-11`);
    expect(other.stammteam.rows.map((r) => r.employeeId)).toEqual([ids.Q1]);
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
    expect(h.kpis.salonWorkedMinutes).toBe(h.stammteam.totalMinutes);
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
});
