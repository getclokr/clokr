/**
 * Issue #1057 — the § 8 / § 12 JArbSchG roster check on every shift write path other than POST:
 * PUT, restore of a Berufsschule-cleanup soft delete, bulk, generate-week and copy-week.
 * POST and the pure rule are in `shift-jarbschg-1057.test.ts`.
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
  auditRowsFor,
} from "../../../../__tests__/setup";
import {
  dbDateStr,
  dowOf,
  futureDateStr,
  holdsStatutoryHolidayInAnyState,
  utcMidnight,
} from "../../../../__tests__/test-dates";

const PASSWORD = "test1234";

/** First Monday at least 14 days ahead whose week and the following week hold no 29 February and no statutory holiday of any Bundesland
 * (a holiday counts into a minor's weekly sum, Issue #1077). */
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
/** `n` days after the anchor Monday (7..13 is the following week). */
const day = (n: number): string =>
  dbDateStr(new Date(utcMidnight(WEEK_MONDAY).getTime() + n * 86_400_000));
const birthFor = (dayIso: string, years: number): string => {
  const [y, m, d] = dayIso.split("-");
  return `${Number(y) - years}-${m}-${d}`;
};
const MINOR_BIRTH = birthFor(WEEK_MONDAY, 16);

describe("JArbSchG § 8 / § 12 on every shift write path (Issue #1057)", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
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
        lastName: "Paths1057",
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

  async function fixtureShift(
    employeeId: string,
    dayOffset: number,
    start: string,
    end: string,
    extra: { deletedAt?: Date; deletedReason?: string } = {},
  ) {
    return app.prisma.shift.create({
      data: {
        employeeId,
        salonId: data.salonId,
        date: new Date(`${day(dayOffset)}T00:00:00Z`),
        startTime: start,
        endTime: end,
        ...extra,
      },
    });
  }

  async function activeShifts(employeeId: string) {
    return app.prisma.shift.findMany({
      where: { employeeId, deletedAt: null },
      orderBy: [{ date: "asc" }, { startTime: "asc" }, { id: "asc" }],
    });
  }

  const auth = () => ({ authorization: `Bearer ${data.adminToken}` });

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "jarbpaths1057");
    await app.prisma.tenantConfig.update({
      where: { tenantId: data.tenant.id },
      data: { defaultBreakOver6h: 30, defaultBreakOver9h: 45 },
    });
    const template = await app.prisma.shiftTemplate.create({
      data: { tenantId: data.tenant.id, name: "Lang1057", startTime: "08:00", endTime: "17:30" },
    });
    templateId = template.id;
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("shift-jarbschg-paths-1057 cleanup failed:", err);
    }
    await closeTestApp();
  });

  // ── PUT ─────────────────────────────────────────────────────────────────────────────────────

  it("PUT: lengthening a minor's shift into a violation is refused, row and audit untouched", async () => {
    const emp = await mkPerson("PutMinor", MINOR_BIRTH);
    const shift = await fixtureShift(emp, 0, "08:00", "16:00");
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/shifts/${shift.id}`,
      headers: auth(),
      payload: { endTime: "18:00" },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(JSON.parse(res.body).code).toBe("JARBSCHG_VIOLATION_DAILY_MAX");
    const row = await app.prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(row.endTime).toBe("16:00");
    expect(await auditRowsFor(app, "Shift", shift.id, "UPDATE")).toHaveLength(0);
    expect(res.body).not.toContain("birthDate");
    expect(res.body).not.toContain(MINOR_BIRTH);
  });

  it("PUT: an already illegal plan stays editable as long as the write does not worsen it", async () => {
    const emp = await mkPerson("PutLegacy", MINOR_BIRTH);
    // Legacy row: gross 10:30, minor net 9:30 (above 8:30), span 10:30 (above 10:00).
    const shift = await fixtureShift(emp, 0, "08:00", "18:30");
    const put = (payload: Record<string, unknown>, q = "") =>
      app.inject({
        method: "PUT",
        url: `/api/v1/shifts/${shift.id}${q}`,
        headers: auth(),
        payload,
      });

    expect((await put({ label: "Neues Etikett" })).statusCode).toBe(200);
    expect((await put({ endTime: "18:00" })).statusCode).toBe(200); // shorter than before
    const worse = await put({ startTime: "07:30" }, "?force=true"); // longer than before
    expect(worse.statusCode, worse.body).toBe(422);
    expect(JSON.parse(worse.body).code).toBe("JARBSCHG_VIOLATION_DAILY_MAX");
  });

  it("PUT: moving an adult's shift onto a minor is checked against the minor, the row stays", async () => {
    const adult = await mkPerson("PutAdult", birthFor(WEEK_MONDAY, 30));
    const minor = await mkPerson("PutTarget", MINOR_BIRTH);
    const shift = await fixtureShift(adult, 0, "08:00", "18:00");
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/shifts/${shift.id}`,
      headers: auth(),
      payload: { employeeId: minor },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(JSON.parse(res.body).code).toBe("JARBSCHG_VIOLATION_DAILY_MAX");
    const row = await app.prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(row.employeeId).toBe(adult);
  });

  // ── restore ─────────────────────────────────────────────────────────────────────────────────

  async function seedBsCleanupShift(employeeId: string) {
    await app.prisma.absence.create({
      data: {
        employeeId,
        type: "VOCATIONAL_SCHOOL",
        source: "PATTERN",
        startDate: new Date(`${day(1)}T00:00:00Z`),
        endDate: new Date(`${day(1)}T00:00:00Z`),
        days: 1.0,
        createdBy: "jarbschg-paths-1057-test",
      },
    });
    return fixtureShift(employeeId, 1, "08:00", "16:00", {
      deletedAt: new Date(),
      deletedReason: "AUTO_BS_DAY_CLEANUP",
    });
  }

  it("restore: bringing a Berufsschule-cleanup shift back onto a school day is refused for a minor, allowed for an adult", async () => {
    const minor = await mkPerson("RestoreMinor", MINOR_BIRTH);
    const minorShift = await seedBsCleanupShift(minor);
    const refused = await app.inject({
      method: "POST",
      url: `/api/v1/shifts/${minorShift.id}/restore`,
      headers: auth(),
    });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(JSON.parse(refused.body).code).toBe("JARBSCHG_VIOLATION_DAILY_MAX");
    const stillDeleted = await app.prisma.shift.findUniqueOrThrow({ where: { id: minorShift.id } });
    expect(stillDeleted.deletedAt).not.toBeNull();

    const adult = await mkPerson("RestoreAdult", birthFor(WEEK_MONDAY, 30));
    const adultShift = await seedBsCleanupShift(adult);
    const ok = await app.inject({
      method: "POST",
      url: `/api/v1/shifts/${adultShift.id}/restore`,
      headers: auth(),
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  // ── bulk ────────────────────────────────────────────────────────────────────────────────────

  it("bulk: one violating item refuses the whole atomic batch, nothing is written for anybody", async () => {
    const minor = await mkPerson("BulkMinor", MINOR_BIRTH);
    const other = await mkPerson("BulkOther", birthFor(WEEK_MONDAY, 30));
    const shifts = [
      { employeeId: other, date: day(0), startTime: "08:00", endTime: "17:00" },
      ...[0, 1, 2, 3, 4].map((d) => ({
        employeeId: minor,
        date: day(d),
        startTime: "08:00",
        endTime: "17:30",
      })),
    ];
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/shifts/bulk",
      headers: auth(),
      payload: { shifts },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(JSON.parse(res.body).code).toBe("JARBSCHG_VIOLATION_WEEKLY_MAX");
    expect(await activeShifts(minor)).toHaveLength(0);
    expect(await activeShifts(other)).toHaveLength(0);
    expect(res.body).not.toContain("birthDate");
  });

  it("bulk: the same five shifts for an adult are created", async () => {
    const adult = await mkPerson("BulkAdult", birthFor(WEEK_MONDAY, 30));
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/shifts/bulk",
      headers: auth(),
      payload: {
        shifts: [0, 1, 2, 3, 4].map((d) => ({
          employeeId: adult,
          date: day(d),
          startTime: "08:00",
          endTime: "17:30",
        })),
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(await activeShifts(adult)).toHaveLength(5);
  });

  // ── generate-week ───────────────────────────────────────────────────────────────────────────

  async function seedPattern(employeeId: string) {
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

  type GenerateResult = {
    create: Array<{ employeeId: string; date: string }>;
    skip: Array<{ employeeId: string; date: string; reason: string; message?: string }>;
  };

  it("generate-week: the violating cell is skipped with reason jarbschg, in preview and commit alike", async () => {
    const minor = await mkPerson("GenMinor", MINOR_BIRTH);
    const adult = await mkPerson("GenAdult", birthFor(WEEK_MONDAY, 30));
    await seedPattern(minor);
    await seedPattern(adult);

    const run = async (commit: boolean): Promise<GenerateResult> => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/shifts/generate-week",
        headers: auth(),
        payload: { weekStart: WEEK_MONDAY, commit },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.body).not.toContain("birthDate");
      return JSON.parse(res.body) as GenerateResult;
    };

    const preview = await run(false);
    const minorCreate = preview.create.filter((c) => c.employeeId === minor).map((c) => c.date);
    expect(minorCreate).toEqual([day(0), day(1), day(2), day(3)]);
    const minorSkip = preview.skip.filter((s) => s.employeeId === minor && s.reason === "jarbschg");
    expect(minorSkip).toHaveLength(1);
    expect(minorSkip[0].date).toBe(day(4));
    expect(minorSkip[0].message).toContain("40 Stunden");
    expect(preview.create.filter((c) => c.employeeId === adult)).toHaveLength(5);
    expect(await activeShifts(minor)).toHaveLength(0); // a preview writes nothing

    await run(true);
    expect((await activeShifts(minor)).map((s) => dbDateStr(s.date))).toEqual([
      day(0),
      day(1),
      day(2),
      day(3),
    ]);
    expect(await activeShifts(adult)).toHaveLength(5);
  });

  // ── copy-week ───────────────────────────────────────────────────────────────────────────────

  it("copy-week: Friday of the target week is skipped with reason jarbschg, in preview and commit", async () => {
    const minor = await mkPerson("CopyMinor", MINOR_BIRTH);
    // Source week: legacy rows written straight to the table, five 8:30 days.
    for (const d of [0, 1, 2, 3, 4]) await fixtureShift(minor, d, "08:00", "17:30");

    const run = async (commit: boolean) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/shifts/copy-week",
        headers: auth(),
        payload: { sourceWeekStart: day(0), targetWeekStart: day(7), commit },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.body).not.toContain("birthDate");
      return JSON.parse(res.body) as GenerateResult;
    };

    const preview = await run(false);
    expect(preview.create.filter((c) => c.employeeId === minor).map((c) => c.date)).toEqual([
      day(7),
      day(8),
      day(9),
      day(10),
    ]);
    const skipped = preview.skip.filter((s) => s.employeeId === minor && s.reason === "jarbschg");
    expect(skipped).toHaveLength(1);
    expect(skipped[0].date).toBe(day(11));
    expect(skipped[0].message).toContain("40 Stunden");

    await run(true);
    const targetDates = (await activeShifts(minor))
      .map((s) => dbDateStr(s.date))
      .filter((d) => d >= day(7));
    expect(targetDates).toEqual([day(7), day(8), day(9), day(10)]);
  });
});
