/**
 * Issue #1076 — §§ 13, 14, 15 (with § 16 Abs. 3 and 4) and 17 JArbSchG on `POST` / `PUT
 * /api/v1/shifts`, end to end. Every case plans a fresh person on a future anchor week, so no case
 * depends on another.
 *
 * Synthetic names only (CLAUDE.md PII rule).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
  grantSystemRole,
} from "../../../../__tests__/setup";
import { dbDateStr, dowOf, futureDateStr, utcMidnight } from "../../../../__tests__/test-dates";

const PASSWORD = "test1234";

/** First Monday at least 14 days ahead whose week holds no 29 February (a birthday on it is awkward). */
function anchorMonday(): string {
  const add = (iso: string, n: number) =>
    dbDateStr(new Date(utcMidnight(iso).getTime() + n * 86_400_000));
  let d = futureDateStr(14);
  while (dowOf(d) !== 1) d = add(d, 1);
  const holdsFeb29 = (mon: string) =>
    Array.from({ length: 8 }, (_, i) => add(mon, i)).some((x) => x.endsWith("-02-29"));
  while (holdsFeb29(d)) d = add(d, 7);
  return d;
}
const WEEK_MONDAY = anchorMonday();
const day = (n: number): string =>
  dbDateStr(new Date(utcMidnight(WEEK_MONDAY).getTime() + n * 86_400_000));
/** The birth date that makes the person exactly `years` old on `dayIso`. */
const birthFor = (dayIso_: string, years: number): string => {
  const [y, m, d] = dayIso_.split("-");
  return `${Number(y) - years}-${m}-${d}`;
};

describe("POST / PUT /shifts — JArbSchG §§ 13-17 (Issue #1076)", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;

  async function mkPerson(label: string, birth: string | null): Promise<string> {
    const s = `${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const user = await app.prisma.user.create({
      data: {
        email: `${s}@example.invalid`,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        isActive: true,
      },
    });
    const employee = await app.prisma.employee.create({
      data: {
        tenantId: data.tenant.id,
        userId: user.id,
        employeeNumber: s.toUpperCase().slice(0, 20),
        firstName: label,
        lastName: "Jarbschg1076",
        hireDate: new Date("2024-09-01T00:00:00Z"),
        birthDate: birth ? new Date(`${birth}T00:00:00Z`) : null,
      },
    });
    await grantSystemRole(app.prisma, {
      tenantId: data.tenant.id,
      userId: user.id,
      role: "EMPLOYEE",
    });
    await app.prisma.workSchedule.create({
      data: {
        employeeId: employee.id,
        type: "SHIFT_BASED",
        weeklyHours: 40,
        validFrom: new Date("2024-09-01T00:00:00Z"),
      },
    });
    await app.prisma.employeeSalonAssignment.create({
      data: {
        tenantId: data.tenant.id,
        employeeId: employee.id,
        salonId: data.salonId,
        kind: "HOME",
        validFrom: new Date("2024-09-01T00:00:00Z"),
        validUntil: null,
      },
    });
    return employee.id;
  }

  async function fixtureShift(employeeId: string, dayOffset: number, start: string, end: string) {
    return app.prisma.shift.create({
      data: {
        employeeId,
        salonId: data.salonId,
        date: new Date(`${day(dayOffset)}T00:00:00Z`),
        startTime: start,
        endTime: end,
      },
    });
  }

  async function post(employeeId: string, dayOffset: number, start: string, end: string, q = "") {
    return app.inject({
      method: "POST",
      url: `/api/v1/shifts${q}`,
      headers: { authorization: `Bearer ${data.adminToken}` },
      payload: { employeeId, date: day(dayOffset), startTime: start, endTime: end },
    });
  }

  async function put(shiftId: string, payload: Record<string, unknown>) {
    return app.inject({
      method: "PUT",
      url: `/api/v1/shifts/${shiftId}`,
      headers: { authorization: `Bearer ${data.adminToken}` },
      payload,
    });
  }

  async function shiftRows(employeeId: string, dayOffset: number) {
    return app.prisma.shift.findMany({
      where: { employeeId, date: new Date(`${day(dayOffset)}T00:00:00Z`), deletedAt: null },
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
    });
  }

  async function createAuditRows(employeeId: string) {
    return app.prisma.auditLog.findMany({
      where: {
        entity: "Shift",
        action: "CREATE",
        newValue: { path: ["employeeId"], equals: employeeId },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  async function expectRefused(
    employeeId: string,
    dayOffset: number,
    start: string,
    end: string,
    code: string,
  ) {
    for (const q of ["", "?force=true"]) {
      const res = await post(employeeId, dayOffset, start, end, q);
      expect(res.statusCode, res.body).toBe(422);
      const body = JSON.parse(res.body);
      expect(body.code).toBe(code);
      expect(body.error).toBe("JArbSchG-Verstoß");
      expect(body.canForce).toBe(false);
    }
    expect(await shiftRows(employeeId, dayOffset)).toHaveLength(0);
    expect(await createAuditRows(employeeId)).toHaveLength(0);
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "jarb1076");
    // shiftStoreHoursMode OFF so the opening-hours rule can never answer before the JArbSchG rule.
    await app.prisma.tenantConfig.update({
      where: { tenantId: data.tenant.id },
      data: { defaultBreakOver6h: 30, defaultBreakOver9h: 45, shiftStoreHoursMode: "OFF" },
    });
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("shift-jarbschg-1076 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("anchor week stays in the future", () => {
    expect(WEEK_MONDAY > futureDateStr(7)).toBe(true);
    expect(dowOf(WEEK_MONDAY)).toBe(1);
  });

  // ── § 14 ───────────────────────────────────────────────────────────────────────────────────────

  for (const years of [16, 17]) {
    it(`§ 14: a ${years}-year-old's 12:00-20:30 is refused with 422 NIGHT_REST, force changes nothing`, async () => {
      const emp = await mkPerson(`Night${years}`, birthFor(WEEK_MONDAY, years));
      await expectRefused(emp, 1, "12:00", "20:30", "JARBSCHG_VIOLATION_NIGHT_REST");
    });
  }

  it("§ 14: 06:00-14:00 and 12:00-20:00 are accepted for a minor", async () => {
    const emp = await mkPerson("NightOk", birthFor(WEEK_MONDAY, 16));
    expect((await post(emp, 0, "06:00", "14:00")).statusCode).toBe(201);
    expect((await post(emp, 2, "12:00", "20:00")).statusCode).toBe(201);
  });

  it("§ 14: a midnight-crossing shift is refused", async () => {
    const emp = await mkPerson("NightCross", birthFor(WEEK_MONDAY, 17));
    await expectRefused(emp, 1, "18:00", "02:00", "JARBSCHG_VIOLATION_NIGHT_REST");
  });

  it("§ 14: the 18th birthday on Thursday: the same shift is accepted", async () => {
    const emp = await mkPerson("NightBirthday", birthFor(day(3), 18));
    expect((await post(emp, 3, "12:00", "20:30")).statusCode).toBe(201);
  });

  // ── § 17 ───────────────────────────────────────────────────────────────────────────────────────

  for (const years of [16, 17]) {
    it(`§ 17: a ${years}-year-old's Sunday shift is refused with 422 SUNDAY_REST`, async () => {
      const emp = await mkPerson(`Sunday${years}`, birthFor(WEEK_MONDAY, years));
      await expectRefused(emp, 6, "10:00", "14:00", "JARBSCHG_VIOLATION_SUNDAY_REST");
    });
  }

  it("§ 17: the 18th birthday on that Sunday: accepted; a Saturday is never refused for being one", async () => {
    const adultSunday = await mkPerson("SundayBirthday", birthFor(day(6), 18));
    expect((await post(adultSunday, 6, "10:00", "14:00")).statusCode).toBe(201);

    const saturday = await mkPerson("Saturday", birthFor(WEEK_MONDAY, 16));
    expect((await post(saturday, 5, "10:00", "14:00")).statusCode).toBe(201);
  });

  // ── § 13 ───────────────────────────────────────────────────────────────────────────────────────

  it("§ 13: 11:30 Freizeit is refused with 422 FREE_TIME, exactly 12:00 is accepted", async () => {
    const emp = await mkPerson("FreeTime", birthFor(WEEK_MONDAY, 16));
    await fixtureShift(emp, 1, "12:00", "20:00");
    await expectRefused(emp, 2, "07:30", "12:00", "JARBSCHG_VIOLATION_FREE_TIME");
    expect((await post(emp, 2, "08:00", "12:00")).statusCode).toBe(201);
  });

  it("§ 13: the 18th birthday on the later day: no § 13, § 5 ArbZG answers (201 at 11 h, 409 below)", async () => {
    const ok = await mkPerson("FreeTimeBirthdayOk", birthFor(day(2), 18));
    await fixtureShift(ok, 1, "12:00", "20:00");
    expect((await post(ok, 2, "07:00", "12:00")).statusCode).toBe(201);

    const rest = await mkPerson("FreeTimeBirthdayRest", birthFor(day(2), 18));
    await fixtureShift(rest, 1, "12:00", "20:00");
    const res = await post(rest, 2, "06:00", "12:00");
    expect(res.statusCode, res.body).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("ARBZG_VIOLATION_REST_PERIOD");
    expect(body.canForce).toBe(true);
  });

  // ── § 15 / § 16 Abs. 3 and 4 ─────────────────────────────────────────────────────────────────

  async function schoolDay(employeeId: string, dayOffset: number) {
    await app.prisma.absence.create({
      data: {
        employeeId,
        type: "VOCATIONAL_SCHOOL",
        source: "PATTERN",
        startDate: new Date(`${day(dayOffset)}T00:00:00Z`),
        endDate: new Date(`${day(dayOffset)}T00:00:00Z`),
        days: 1.0,
        createdBy: "jarbschg-1076-test",
      },
    });
  }

  async function tueToFri(employeeId: string) {
    for (const d of [1, 2, 3, 4]) await fixtureShift(employeeId, d, "09:00", "14:00");
  }

  it("§ 15: a Berufsschultag counts as a day, so a sixth day is refused; without it the Saturday is accepted", async () => {
    const withSchool = await mkPerson("FiveDaySchool", birthFor(WEEK_MONDAY, 16));
    await schoolDay(withSchool, 0);
    await tueToFri(withSchool);
    await expectRefused(withSchool, 5, "09:00", "14:00", "JARBSCHG_VIOLATION_FIVE_DAY_WEEK");

    const withoutSchool = await mkPerson("FiveDayFree", birthFor(WEEK_MONDAY, 16));
    await tueToFri(withoutSchool);
    expect((await post(withoutSchool, 5, "09:00", "14:00")).statusCode).toBe(201);
  });

  it("§ 15: six days of shifts are refused for a 17-year-old", async () => {
    const emp = await mkPerson("FiveDaySeventeen", birthFor(WEEK_MONDAY, 17));
    for (const d of [0, 1, 2, 3, 4]) await fixtureShift(emp, d, "09:00", "14:00");
    await expectRefused(emp, 5, "09:00", "14:00", "JARBSCHG_VIOLATION_FIVE_DAY_WEEK");
  });

  it("§ 16 Abs. 4: a Monday Ausgleich of 08:00-11:00 keeps the Saturday lawful, 08:00-13:30 does not", async () => {
    const ok = await mkPerson("FiveDayCompOk", birthFor(WEEK_MONDAY, 16));
    await tueToFri(ok);
    await fixtureShift(ok, 0, "08:00", "11:00");
    expect((await post(ok, 5, "09:00", "14:00")).statusCode).toBe(201);

    const late = await mkPerson("FiveDayCompLate", birthFor(WEEK_MONDAY, 16));
    await tueToFri(late);
    await fixtureShift(late, 0, "08:00", "13:30");
    await expectRefused(late, 5, "09:00", "14:00", "JARBSCHG_VIOLATION_FIVE_DAY_WEEK");
  });

  it("§ 15: the 18th birthday on the Saturday and an adult are not counted", async () => {
    const birthday = await mkPerson("FiveDayBirthday", birthFor(day(5), 18));
    for (const d of [0, 1, 2, 3, 4]) await fixtureShift(birthday, d, "09:00", "14:00");
    expect((await post(birthday, 5, "09:00", "14:00")).statusCode).toBe(201);

    const adult = await mkPerson("FiveDayAdult", birthFor(WEEK_MONDAY, 18));
    for (const d of [0, 1, 2, 3, 4]) await fixtureShift(adult, d, "09:00", "14:00");
    expect((await post(adult, 5, "09:00", "14:00")).statusCode).toBe(201);
  });

  // ── AC2: an existing illegal plan never blocks the roster ─────────────────────────────────────

  it("AC2: a label-only PUT of a minor's stored Sunday shift answers 200, a lawful new shift 201", async () => {
    const emp = await mkPerson("Legacy", birthFor(WEEK_MONDAY, 16));
    const stored = await fixtureShift(emp, 6, "10:00", "18:00");
    const res = await put(stored.id, { label: "Aushilfe" });
    expect(res.statusCode, res.body).toBe(200);
    expect((await post(emp, 1, "09:00", "14:00")).statusCode).toBe(201);
  });

  it("no body carries a birth date", async () => {
    const birth = birthFor(WEEK_MONDAY, 16);
    const emp = await mkPerson("NoLeak", birth);
    const refused = await post(emp, 6, "10:00", "14:00");
    expect(refused.statusCode).toBe(422);
    expect(refused.body).not.toContain("birthDate");
    expect(refused.body).not.toContain(birth);
  });
});
