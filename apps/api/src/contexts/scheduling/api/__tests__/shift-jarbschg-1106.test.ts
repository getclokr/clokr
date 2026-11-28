/**
 * Issue #1106 — § 18 JArbSchG (Feiertagsruhe) on every roster write path, end to end: a person under
 * 18 is not planned on a statutory holiday at the SHIFT'S salon, and not after 14:00 on 24 and 31
 * December. Every case plans a fresh person on a future anchor week, so no case depends on another.
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
  createTestSalon,
} from "../../../../__tests__/setup";
import {
  dbDateStr,
  dowOf,
  futureDateStr,
  holdsStatutoryHolidayInAnyState,
  utcMidnight,
} from "../../../../__tests__/test-dates";

const PASSWORD = "test1234";

/**
 * First Monday at least 14 days ahead whose two weeks hold no 29 February (a birthday on it is
 * awkward) and no statutory holiday of any Bundesland: the only holidays in the anchor weeks are the
 * manual salon holidays this file adds.
 */
function anchorMonday(): string {
  const add = (iso: string, n: number) =>
    dbDateStr(new Date(utcMidnight(iso).getTime() + n * 86_400_000));
  let d = futureDateStr(14);
  while (dowOf(d) !== 1) d = add(d, 1);
  const holdsFeb29 = (mon: string) =>
    Array.from({ length: 14 }, (_, i) => add(mon, i)).some((x) => x.endsWith("-02-29"));
  while (holdsFeb29(d) || holdsStatutoryHolidayInAnyState(d, 14)) d = add(d, 7);
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
/** DD.MM.YYYY, as the messages print a date. */
const de = (iso: string): string => iso.split("-").reverse().join(".");

/** First `${year}-${monthDay}` on or after two days ahead that is not a Sunday. */
function nextNonSundayOn(monthDay: string): string {
  const start = futureDateStr(2);
  for (let year = Number(start.slice(0, 4)); ; year++) {
    const iso = `${year}-${monthDay}`;
    if (iso >= start && dowOf(iso) !== 0) return iso;
  }
}

describe("POST /shifts — § 18 JArbSchG Feiertagsruhe (Issue #1106)", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let otherSalonId: string;
  let bySalonId: string;

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
        lastName: "Jarbschg1106",
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

  /** A manual salon holiday; written straight to the table (the test file is outside the boundary scan). */
  async function addSalonHoliday(salonId: string, iso: string, name: string) {
    const salon = await app.prisma.salon.findUniqueOrThrow({ where: { id: salonId } });
    await app.prisma.publicHoliday.create({
      data: {
        tenantId: data.tenant.id,
        salonId,
        date: new Date(`${iso}T00:00:00Z`),
        name,
        federalState: salon.federalState,
        year: Number(iso.slice(0, 4)),
      },
    });
  }

  async function post(
    employeeId: string,
    iso: string,
    start: string,
    end: string,
    q = "",
    salonId?: string,
  ) {
    return app.inject({
      method: "POST",
      url: `/api/v1/shifts${q}`,
      headers: { authorization: `Bearer ${data.adminToken}` },
      payload: {
        employeeId,
        date: iso,
        startTime: start,
        endTime: end,
        ...(salonId ? { salonId } : {}),
      },
    });
  }

  async function shiftRows(employeeId: string, iso: string) {
    return app.prisma.shift.findMany({
      where: { employeeId, date: new Date(`${iso}T00:00:00Z`), deletedAt: null },
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
    iso: string,
    start: string,
    end: string,
    code: string,
    salonId?: string,
  ): Promise<{ message: string }> {
    let last = { message: "" };
    for (const q of ["", "?force=true"]) {
      const res = await post(employeeId, iso, start, end, q, salonId);
      expect(res.statusCode, res.body).toBe(422);
      const body = JSON.parse(res.body);
      expect(body.code).toBe(code);
      expect(body.error).toBe("JArbSchG-Verstoß");
      expect(body.canForce).toBe(false);
      expect(res.body).not.toContain("birthDate");
      last = body;
    }
    expect(await shiftRows(employeeId, iso)).toHaveLength(0);
    expect(await createAuditRows(employeeId)).toHaveLength(0);
    return last;
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "jarb1106");
    // shiftStoreHoursMode OFF so the opening-hours rule can never answer before the JArbSchG rule.
    await app.prisma.tenantConfig.update({
      where: { tenantId: data.tenant.id },
      data: { defaultBreakOver6h: 30, defaultBreakOver9h: 45, shiftStoreHoursMode: "OFF" },
    });
    await addSalonHoliday(data.salonId, day(2), "Testfeiertag 1106");
    await addSalonHoliday(data.salonId, day(9), "Testfeiertag 1106 B");
    otherSalonId = (await createTestSalon(app.prisma, data.tenant.id, { name: "Zweitsalon 1106" }))
      .id;
    bySalonId = (
      await createTestSalon(app.prisma, data.tenant.id, {
        name: "Salon Bayern 1106",
        federalState: "BAYERN",
      })
    ).id;
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("shift-jarbschg-1106 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("T0: the anchor week stays in the future and starts on a Monday", () => {
    expect(WEEK_MONDAY > futureDateStr(7)).toBe(true);
    expect(dowOf(WEEK_MONDAY)).toBe(1);
  });

  it("T1: a 16-year-old's shift on a salon holiday is refused with 422 HOLIDAY_REST, force changes nothing", async () => {
    const emp = await mkPerson("Holiday16", birthFor(WEEK_MONDAY, 16));
    const body = await expectRefused(
      emp,
      day(2),
      "10:00",
      "14:00",
      "JARBSCHG_VIOLATION_HOLIDAY_REST",
    );
    expect(body.message).toBe(
      `Am ${de(day(2))} (Testfeiertag 1106) ist eine Schicht geplant. Jugendliche dürfen an gesetzlichen Feiertagen nicht beschäftigt werden (§ 18 Abs. 1 JArbSchG).`,
    );
    expect(body.message).not.toContain(birthFor(WEEK_MONDAY, 16));
  });

  it("T2: a 30-year-old's shift on the same holiday is accepted", async () => {
    const emp = await mkPerson("HolidayAdult", birthFor(WEEK_MONDAY, 30));
    expect((await post(emp, day(2), "10:00", "14:00")).statusCode).toBe(201);
  });

  it("T3: the shift's salon decides — the same minor in a salon without that holiday gets 201", async () => {
    const emp = await mkPerson("HolidaySalon", birthFor(WEEK_MONDAY, 16));
    const res = await post(emp, day(2), "10:00", "14:00", "", otherSalonId);
    expect(res.statusCode, res.body).toBe(201);
  });

  it("T4: a computed holiday follows the Bundesland of the shift's salon (Reformationstag: NI yes, BY no)", async () => {
    const reformation = nextNonSundayOn("10-31");
    const refusedPerson = await mkPerson("Reformation16", birthFor(reformation, 16));
    const body = await expectRefused(
      refusedPerson,
      reformation,
      "08:00",
      "12:00",
      "JARBSCHG_VIOLATION_HOLIDAY_REST",
    );
    expect(body.message).toContain("(Reformationstag)");

    const bavarian = await mkPerson("Reformation16By", birthFor(reformation, 16));
    const res = await post(bavarian, reformation, "08:00", "12:00", "", bySalonId);
    expect(res.statusCode, res.body).toBe(201);
  });
});
