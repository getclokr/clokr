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
  auditRowsFor,
} from "../../../../__tests__/setup";
import {
  dbDateStr,
  dowOf,
  futureDateStr,
  holdsStatutoryHolidayInAnyState,
  utcMidnight,
} from "../../../../__tests__/test-dates";

import { loadMinorShiftWeeks } from "../../minor-shift-limits";

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
  let templateId: string;

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

  async function fixtureShift(
    employeeId: string,
    iso: string,
    start: string,
    end: string,
    extra: { salonId?: string; deletedAt?: Date; deletedReason?: string } = {},
  ) {
    return app.prisma.shift.create({
      data: {
        employeeId,
        salonId: extra.salonId ?? data.salonId,
        date: new Date(`${iso}T00:00:00Z`),
        startTime: start,
        endTime: end,
        ...(extra.deletedAt ? { deletedAt: extra.deletedAt } : {}),
        ...(extra.deletedReason ? { deletedReason: extra.deletedReason } : {}),
      },
    });
  }

  const auth = () => ({ authorization: `Bearer ${data.adminToken}` });

  async function put(shiftId: string, payload: Record<string, unknown>, q = "") {
    return app.inject({
      method: "PUT",
      url: `/api/v1/shifts/${shiftId}${q}`,
      headers: auth(),
      payload,
    });
  }

  async function activeShifts(employeeId: string) {
    return app.prisma.shift.findMany({
      where: { employeeId, deletedAt: null },
      orderBy: [{ date: "asc" }, { startTime: "asc" }, { id: "asc" }],
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
    templateId = (
      await app.prisma.shiftTemplate.create({
        data: { tenantId: data.tenant.id, name: "Kurz1106", startTime: "08:00", endTime: "14:00" },
      })
    ).id;
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

  // ── 24 and 31 December ─────────────────────────────────────────────────────────────────────────

  it("T5: 24 December — a shift ending at 14:00 is accepted, one minute-range after 14:00 is refused, an adult is free", async () => {
    const eve = nextNonSundayOn("12-24");
    const ok = await mkPerson("Eve16Ok", birthFor(eve, 16));
    expect((await post(ok, eve, "08:00", "14:00")).statusCode).toBe(201);

    const late = await mkPerson("Eve16Late", birthFor(eve, 16));
    const body = await expectRefused(
      late,
      eve,
      "08:00",
      "15:00",
      "JARBSCHG_VIOLATION_HOLIDAY_REST",
    );
    expect(body.message).toContain("nach 14 Uhr");
    expect(body.message).toContain(de(eve));

    const adult = await mkPerson("EveAdult", birthFor(eve, 30));
    expect((await post(adult, eve, "08:00", "15:00")).statusCode).toBe(201);
  });

  // ── PUT: Altbestand and moving onto the holiday ───────────────────────────────────────────────

  it("T6: PUT — a stored holiday shift stays editable, only growth is refused, the roster is not locked", async () => {
    const emp = await mkPerson("PutLegacy", birthFor(WEEK_MONDAY, 16));
    const stored = await fixtureShift(emp, day(2), "10:00", "14:00");

    expect((await put(stored.id, { label: "Neu" })).statusCode).toBe(200);
    expect((await put(stored.id, { endTime: "13:00" })).statusCode).toBe(200);
    const updatesBefore = (await auditRowsFor(app, "Shift", stored.id, "UPDATE")).length;

    for (const q of ["", "?force=true"]) {
      const refused = await put(stored.id, { endTime: "15:00" }, q);
      expect(refused.statusCode, refused.body).toBe(422);
      expect(JSON.parse(refused.body).code).toBe("JARBSCHG_VIOLATION_HOLIDAY_REST");
      expect(JSON.parse(refused.body).canForce).toBe(false);
    }
    const row = await app.prisma.shift.findUniqueOrThrow({ where: { id: stored.id } });
    expect(row.endTime).toBe("13:00");
    expect(await auditRowsFor(app, "Shift", stored.id, "UPDATE")).toHaveLength(updatesBefore);

    // Moving it to a salon without that holiday is a way out, not a lock.
    expect((await put(stored.id, { salonId: otherSalonId })).statusCode).toBe(200);
    // And a new shift on another day of that week is accepted.
    expect((await post(emp, day(3), "10:00", "14:00")).statusCode).toBe(201);
  });

  it("T7: PUT — moving a shift onto the holiday is refused, the row keeps its date", async () => {
    const emp = await mkPerson("PutOnto", birthFor(WEEK_MONDAY, 16));
    const stored = await fixtureShift(emp, day(1), "10:00", "14:00");
    const res = await put(stored.id, { date: day(2) });
    expect(res.statusCode, res.body).toBe(422);
    expect(JSON.parse(res.body).code).toBe("JARBSCHG_VIOLATION_HOLIDAY_REST");
    const row = await app.prisma.shift.findUniqueOrThrow({ where: { id: stored.id } });
    expect(dbDateStr(row.date)).toBe(day(1));
  });

  // ── restore ────────────────────────────────────────────────────────────────────────────────────

  it("T8: restore — bringing a removed shift back onto the holiday is refused for a minor, allowed for an adult", async () => {
    const restoreOf = async (label: string, years: number) => {
      const emp = await mkPerson(label, birthFor(WEEK_MONDAY, years));
      const shift = await fixtureShift(emp, day(2), "10:00", "14:00", {
        deletedAt: new Date(),
        deletedReason: "AUTO_BS_DAY_CLEANUP",
      });
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/shifts/${shift.id}/restore`,
        headers: auth(),
      });
      return { shift, res };
    };
    const minor = await restoreOf("RestoreMinor", 16);
    expect(minor.res.statusCode, minor.res.body).toBe(422);
    expect(JSON.parse(minor.res.body).code).toBe("JARBSCHG_VIOLATION_HOLIDAY_REST");
    const stillDeleted = await app.prisma.shift.findUniqueOrThrow({
      where: { id: minor.shift.id },
    });
    expect(stillDeleted.deletedAt).not.toBeNull();

    const adult = await restoreOf("RestoreAdult", 30);
    expect(adult.res.statusCode, adult.res.body).toBe(200);
  });

  // ── bulk ───────────────────────────────────────────────────────────────────────────────────────

  it("T9: bulk — one holiday item refuses the whole batch; adults alone are created", async () => {
    const minor = await mkPerson("BulkMinor", birthFor(WEEK_MONDAY, 16));
    const adult = await mkPerson("BulkAdult", birthFor(WEEK_MONDAY, 30));
    const item = (employeeId: string, d: number) => ({
      employeeId,
      date: day(d),
      startTime: "10:00",
      endTime: "14:00",
    });
    const refused = await app.inject({
      method: "POST",
      url: "/api/v1/shifts/bulk",
      headers: auth(),
      payload: { shifts: [item(minor, 1), item(minor, 2), item(adult, 1)] },
    });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(JSON.parse(refused.body).code).toBe("JARBSCHG_VIOLATION_HOLIDAY_REST");
    expect(await activeShifts(minor)).toHaveLength(0);
    expect(await activeShifts(adult)).toHaveLength(0);

    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/shifts/bulk",
      headers: auth(),
      payload: { shifts: [item(adult, 1), item(adult, 2)] },
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(await activeShifts(adult)).toHaveLength(2);
  });

  // ── generate-week ──────────────────────────────────────────────────────────────────────────────

  type PlanResult = {
    create: Array<{ employeeId: string; date: string }>;
    skip: Array<{ employeeId: string; date: string; reason: string; message?: string }>;
  };

  it("T10: generate-week — exactly the holiday cell is skipped with reason jarbschg, preview == commit", async () => {
    const minor = await mkPerson("GenMinor", birthFor(WEEK_MONDAY, 16));
    const adult = await mkPerson("GenAdult", birthFor(WEEK_MONDAY, 30));
    for (const employeeId of [minor, adult]) {
      for (let dow = 0; dow <= 4; dow++) {
        await app.prisma.employeeShiftPattern.create({
          data: {
            employeeId,
            dayOfWeek: dow,
            templateId,
            validFrom: new Date("2024-09-01T00:00:00Z"),
          },
        });
      }
    }
    const run = async (commit: boolean): Promise<PlanResult> => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/shifts/generate-week",
        headers: auth(),
        payload: { weekStart: WEEK_MONDAY, commit },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.body).not.toContain("birthDate");
      return JSON.parse(res.body) as PlanResult;
    };

    const preview = await run(false);
    expect(preview.create.filter((c) => c.employeeId === minor).map((c) => c.date)).toEqual([
      day(0),
      day(1),
      day(3),
      day(4),
    ]);
    const skipped = preview.skip.filter((s) => s.employeeId === minor && s.reason === "jarbschg");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ date: day(2), reason: "jarbschg" });
    expect(skipped[0].message).toContain("§ 18 Abs. 1 JArbSchG");
    expect(preview.create.filter((c) => c.employeeId === adult)).toHaveLength(5);
    expect(await activeShifts(minor)).toHaveLength(0); // a preview writes nothing

    await run(true);
    expect((await activeShifts(minor)).map((s) => dbDateStr(s.date))).toEqual([
      day(0),
      day(1),
      day(3),
      day(4),
    ]);
    expect(await activeShifts(adult)).toHaveLength(5);
  });

  // ── copy-week ──────────────────────────────────────────────────────────────────────────────────

  it("T11: copy-week — the holiday cell of the target week is skipped with reason jarbschg, preview == commit", async () => {
    const minor = await mkPerson("CopyMinor", birthFor(WEEK_MONDAY, 16));
    // Source week: day(2) is stored Altbestand on a holiday, written straight to the table.
    for (const d of [0, 1, 2, 3]) await fixtureShift(minor, day(d), "08:00", "14:00");

    const run = async (commit: boolean): Promise<PlanResult> => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/shifts/copy-week",
        headers: auth(),
        payload: { sourceWeekStart: day(0), targetWeekStart: day(7), commit },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.body).not.toContain("birthDate");
      return JSON.parse(res.body) as PlanResult;
    };

    const preview = await run(false);
    expect(preview.create.filter((c) => c.employeeId === minor).map((c) => c.date)).toEqual([
      day(7),
      day(8),
      day(10),
    ]);
    const skipped = preview.skip.filter((s) => s.employeeId === minor && s.reason === "jarbschg");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ date: day(9), reason: "jarbschg" });
    expect(skipped[0].message).toContain("§ 18 Abs. 1 JArbSchG");

    await run(true);
    const targetDates = (await activeShifts(minor))
      .map((s) => dbDateStr(s.date))
      .filter((d) => d >= day(7));
    expect(targetDates).toEqual([day(7), day(8), day(10)]);
  });

  // ── loader ─────────────────────────────────────────────────────────────────────────────────────

  it("T12: loadMinorShiftWeeks — the holiday map holds the salons of the shifts, all tenant salons on request", async () => {
    const minor = await mkPerson("Loader", birthFor(WEEK_MONDAY, 16));
    await fixtureShift(minor, day(1), "10:00", "14:00");

    const own = await loadMinorShiftWeeks(
      app.prisma,
      data.tenant.id,
      [minor],
      utcMidnight(WEEK_MONDAY),
    );
    const ownMap = own.get(minor)?.publicHolidaysBySalon;
    expect(Object.keys(ownMap ?? {})).toEqual([data.salonId]);
    expect(ownMap?.[data.salonId]).toEqual({ [day(2)]: "Testfeiertag 1106" });

    const all = await loadMinorShiftWeeks(
      app.prisma,
      data.tenant.id,
      [minor],
      utcMidnight(WEEK_MONDAY),
      { allTenantSalons: true },
    );
    const allMap = all.get(minor)?.publicHolidaysBySalon ?? {};
    expect(Object.keys(allMap).sort()).toEqual([data.salonId, otherSalonId, bySalonId].sort());
    expect(allMap[data.salonId]).toEqual({ [day(2)]: "Testfeiertag 1106" });
    expect(allMap[otherSalonId]).toEqual({});
    expect(allMap[bySalonId]).toEqual({});
  });
});
