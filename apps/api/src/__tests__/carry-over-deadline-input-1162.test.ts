/**
 * Issue #1162 — a carry-over deadline typed by hand (PUT /api/v1/settings/vacation/:employeeId) is
 * stored as the END of the Stichtag (23:59:59Z), exactly like the automatically built deadlines.
 *
 * Before the fix the route did `new Date("YYYY-MM-DD")` = 00:00 UTC of the Stichtag, so a hand-
 * entered deadline forfeited the carry-over about 24 h early, and re-saving an automatic deadline
 * unchanged through the admin form rewrote it to 00:00. Fixed dates only (2027/2028); the
 * forfeiture checks pass the reference instant explicitly, nothing reads `new Date()`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
  soleAuditRowOrNull,
} from "./setup";
import { carryOverAtRiskDays, effectiveCarryOverDays } from "../contexts/absence/leave-days";
import {
  carryOverDeadlineFor,
  parseCarryOverDeadlineInput,
} from "../contexts/absence/carry-over-deadline";

const ORIGINAL_TZ = process.env.TZ;
const END_OF_STICHTAG = "2027-03-31T23:59:59.000Z";

describe("Issue #1162 — parseCarryOverDeadlineInput (pure)", () => {
  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it("a date-only Stichtag is the end of that UTC day, whatever the host zone", () => {
    for (const zone of ["UTC", "Pacific/Auckland", "Europe/Berlin", "America/Los_Angeles"]) {
      process.env.TZ = zone;
      expect(parseCarryOverDeadlineInput("2027-03-31")?.toISOString(), zone).toBe(END_OF_STICHTAG);
    }
  });

  it("a datetime means its UTC date part, normalised to the end of that day", () => {
    const cases: Array<[string, string]> = [
      ["2027-03-31T00:00:00.000Z", END_OF_STICHTAG], // an old stored 00:00 value echoed back
      ["2027-03-31T23:59:59.000Z", END_OF_STICHTAG], // the canonical value echoed back
      ["2027-03-31T12:30:00Z", END_OF_STICHTAG],
      ["2027-04-01T01:00:00+02:00", END_OF_STICHTAG], // 31 March 23:00Z - the UTC day wins
      ["2027-03-31T22:00:00-05:00", "2027-04-01T23:59:59.000Z"], // 1 April 03:00Z
    ];
    for (const [input, expected] of cases) {
      expect(parseCarryOverDeadlineInput(input)?.toISOString(), input).toBe(expected);
    }
  });

  it("is the same instant the automatic writers build", () => {
    expect(parseCarryOverDeadlineInput("2027-03-31")!.getTime()).toBe(
      carryOverDeadlineFor(2027, 3, 31).getTime(),
    );
  });

  it("no deadline and unusable input", () => {
    expect(parseCarryOverDeadlineInput(null)).toBeNull();
    expect(parseCarryOverDeadlineInput(undefined)).toBeNull();
    expect(parseCarryOverDeadlineInput("")).toBeNull();
    expect(parseCarryOverDeadlineInput("garbage")).toBeNull();
    expect(parseCarryOverDeadlineInput("2027-02-31")).toBeNull(); // calendar overflow
    expect(parseCarryOverDeadlineInput("2027-13-01")).toBeNull();
    expect(parseCarryOverDeadlineInput("2027-03-31T10:00:00")).toBeNull(); // no offset: host-zone read
    expect(parseCarryOverDeadlineInput("31.03.2027")).toBeNull();
  });
});

describe("Issue #1162 — PUT /settings/vacation stores the Stichtag as 23:59:59Z", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;

  async function mkEmployee(label: string, deadline: Date | null = null): Promise<string> {
    const uid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const user = await app.prisma.user.create({
      data: { email: `cdin-${label}-${uid}@test.de`, passwordHash: "x", isActive: true },
    });
    const employee = await app.prisma.employee.create({
      data: {
        tenantId: data.tenant.id,
        userId: user.id,
        employeeNumber: `CDIN-${label}-${uid}`,
        firstName: "T",
        lastName: "T",
        hireDate: new Date(Date.UTC(2024, 0, 1)),
      },
    });
    await app.prisma.workSchedule.create({
      data: {
        employeeId: employee.id,
        type: "FIXED_SCHEDULE",
        mondayHours: 8,
        tuesdayHours: 8,
        wednesdayHours: 8,
        thursdayHours: 8,
        fridayHours: 8,
        saturdayHours: 0,
        sundayHours: 0,
        validFrom: new Date(Date.UTC(2024, 0, 1)),
      },
    });
    await app.prisma.overtimeAccount.create({ data: { employeeId: employee.id, balanceHours: 0 } });
    await app.prisma.leaveEntitlement.create({
      data: {
        employeeId: employee.id,
        leaveTypeId: data.vacationType.id,
        year: 2027,
        totalDays: 30,
        usedDays: 0,
        carriedOverDays: 3,
        carryOverDeadline: deadline,
      },
    });
    return employee.id;
  }

  const putVacation = (employeeId: string, body: Record<string, unknown>) =>
    app.inject({
      method: "PUT",
      url: `/api/v1/settings/vacation/${employeeId}`,
      headers: { authorization: `Bearer ${data.adminToken}` },
      payload: body,
    });

  const get2027 = (employeeId: string) =>
    app.prisma.leaveEntitlement.findUniqueOrThrow({
      where: {
        employeeId_leaveTypeId_year: { employeeId, leaveTypeId: data.vacationType.id, year: 2027 },
      },
    });

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "cdin");
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("Test cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("a date-only deadline is stored as 23:59:59Z of that day, and the audit row carries before and after", async () => {
    const employeeId = await mkEmployee("d1", new Date(Date.UTC(2027, 5, 30, 23, 59, 59)));
    const before = await get2027(employeeId);

    const res = await putVacation(employeeId, {
      year: 2027,
      totalDays: 30,
      carriedOverDays: 3,
      carryOverDeadline: "2027-03-31",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(
      new Date((res.json() as { carryOverDeadline: string }).carryOverDeadline).toISOString(),
    ).toBe(END_OF_STICHTAG);
    expect((await get2027(employeeId)).carryOverDeadline?.toISOString()).toBe(END_OF_STICHTAG);

    const audit = await soleAuditRowOrNull(app.prisma, {
      where: { action: "UPDATE", entity: "LeaveEntitlement", entityId: before.id },
    });
    expect(audit, "the settings write stays audited").not.toBeNull();
    expect(
      new Date((audit!.oldValue as { carryOverDeadline: string }).carryOverDeadline).toISOString(),
    ).toBe("2027-06-30T23:59:59.000Z");
    expect(
      new Date((audit!.newValue as { carryOverDeadline: string }).carryOverDeadline).toISOString(),
    ).toBe(END_OF_STICHTAG);
  });

  it("a datetime deadline is accepted: its UTC date part, normalised to 23:59:59Z", async () => {
    const employeeId = await mkEmployee("d2");

    const res = await putVacation(employeeId, {
      year: 2027,
      totalDays: 30,
      carriedOverDays: 3,
      carryOverDeadline: "2027-03-31T00:00:00.000Z",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await get2027(employeeId)).carryOverDeadline?.toISOString()).toBe(END_OF_STICHTAG);
  });

  it("re-saving an automatic deadline unchanged through the form leaves the instant as it was", async () => {
    const employeeId = await mkEmployee("d3", carryOverDeadlineFor(2027, 3, 31));

    // The admin form loads the stored value, shows its date part and posts that date back.
    const res = await putVacation(employeeId, {
      year: 2027,
      totalDays: 30,
      carriedOverDays: 3,
      carryOverDeadline: "2027-03-31",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await get2027(employeeId)).carryOverDeadline?.toISOString()).toBe(END_OF_STICHTAG);
  });

  it("an explicit null still removes the deadline", async () => {
    const employeeId = await mkEmployee("d4", carryOverDeadlineFor(2027, 3, 31));
    const res = await putVacation(employeeId, {
      year: 2027,
      totalDays: 30,
      carriedOverDays: 3,
      carryOverDeadline: null,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await get2027(employeeId)).carryOverDeadline).toBeNull();
  });

  it("an input that is no date is a 400 in German and writes nothing", async () => {
    const employeeId = await mkEmployee("d5", carryOverDeadlineFor(2027, 3, 31));
    for (const bad of ["garbage", "2027-02-31", "2027-03-31T10:00:00", "31.03.2027"]) {
      const res = await putVacation(employeeId, {
        year: 2027,
        totalDays: 30,
        carriedOverDays: 3,
        carryOverDeadline: bad,
      });
      expect(res.statusCode, bad).toBe(400);
      expect((res.json() as { message: string }).message, bad).toContain("Übertragsfrist");
    }
    expect((await get2027(employeeId)).carryOverDeadline?.toISOString()).toBe(END_OF_STICHTAG);
  });

  it("forfeiture does not start before the end of the Stichtag: 12:00 on the day still has the carry, 00:00:01 the day after has not", async () => {
    const employeeId = await mkEmployee("d6");
    const res = await putVacation(employeeId, {
      year: 2027,
      totalDays: 30,
      carriedOverDays: 3,
      carryOverDeadline: "2027-03-31",
    });
    expect(res.statusCode, res.body).toBe(200);
    const row = await get2027(employeeId);
    const tenantId = data.tenant.id;

    const stichtagNoon = new Date(Date.UTC(2027, 2, 31, 12, 0, 0));
    const nextDayStart = new Date(Date.UTC(2027, 3, 1, 0, 0, 1));

    // Forfeiture of what was not taken (a documented Hinweis is assumed: hinweisIssued = true).
    expect(await effectiveCarryOverDays(app.prisma, { ...row, tenantId }, stichtagNoon, true)).toBe(
      3,
    );
    expect(await effectiveCarryOverDays(app.prisma, { ...row, tenantId }, nextDayStart, true)).toBe(
      0,
    );

    // The at-risk figure (what the warning cron and the Resturlaub facade report).
    expect(await carryOverAtRiskDays(app.prisma, row, tenantId, stichtagNoon)).toBe(3);
    expect(await carryOverAtRiskDays(app.prisma, row, tenantId, nextDayStart)).toBe(0);
  });
});
