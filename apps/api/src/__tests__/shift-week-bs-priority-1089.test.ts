/**
 * Issue #1089 — the roster Planungs-Soll gives a Berufsschultag priority over leave and absences.
 *
 * `GET /shifts/week` prices every leave row and every non-Berufsschule absence row with the
 * Ø-method. Before #1089 a leave row spanning a Berufsschultag relieved that day as well, although
 * Arbeitszeitkonto ("Berufsschule hat Vorrang", Issue #1080, `bsDayPriority()`) relieves it only
 * through the Berufsschule credit. The planner figure is display only, never stored.
 *
 * Oracle: a person whose leave runs straight over the Berufsschultag must show exactly the four
 * minute maps of a person whose leave is split around it. Hand-derived pins (38 h, five workdays,
 * 7.6 h = 456 min per day): full week 2280, one day 456, four days 1824.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getTestApp,
  closeTestApp,
  cleanupTestData,
  createTestSalon,
  grantSystemRole,
} from "./setup";
import { holidayFreeMondayStr } from "./test-dates";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";

const TZ = "Europe/Berlin";

const DAY_SOLL_MIN = 456; // 7.6 h
const FOUR_DAYS_MIN = 1824; // Mon, Tue, Thu, Fri

type WeekBody = {
  contractSollMinutesByEmp: Record<string, number>;
  vocationalSchoolMinutesByEmp: Record<string, number>;
  leaveMinutesByEmp: Record<string, number>;
  absenceMinutesByEmp: Record<string, number>;
  availability: Array<{ employeeId: string; date: string; availability: string }>;
};

describe("Issue #1089 — the planner Soll relieves a Berufsschultag exactly once", () => {
  let app: FastifyInstance;
  let tenantId: string;
  let adminToken: string;
  let weekMonday: string;
  let suffix: string;
  let vacationTypeId: string;

  function dayOffset(offset: number): Date {
    const d = new Date(weekMonday + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + offset);
    return d;
  }

  beforeAll(async () => {
    app = await getTestApp();
    const prisma = app.prisma;
    suffix = "1089-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    weekMonday = holidayFreeMondayStr(10, "NI");

    const tenant = await prisma.tenant.create({
      data: {
        name: `Issue 1089 Test ${suffix}`,
        slug: `issue-1089-${suffix}`,
        federalState: "NIEDERSACHSEN",
      },
    });
    tenantId = tenant.id;
    await createTestSalon(prisma, tenantId);
    await prisma.tenantConfig.create({
      data: { tenantId, defaultVacationDays: 30, timezone: TZ },
    });

    const adminUser = await prisma.user.create({
      data: {
        email: `admin-${suffix}@test.de`,
        passwordHash: await bcrypt.hash("test1234", 10),
        isActive: true,
      },
    });
    await prisma.employee.create({
      data: {
        tenantId,
        userId: adminUser.id,
        employeeNumber: `ADM-${suffix}`,
        firstName: "Admin",
        lastName: "Test",
        hireDate: new Date("2024-01-01"),
      },
    });
    await grantSystemRole(prisma, { tenantId, userId: adminUser.id, role: "ADMIN" });

    const vacation = await prisma.leaveType.create({
      data: {
        tenantId,
        code: "VACATION",
        name: "Urlaub",
        isPaid: true,
        requiresApproval: true,
        color: "#3B82F6",
      },
    });
    vacationTypeId = vacation.id;

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: adminUser.email, password: "test1234" },
    });
    adminToken = JSON.parse(loginRes.body).accessToken;
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, tenantId);
    } catch (err) {
      console.error("Issue 1089 test cleanup failed:", err);
    }
    await closeTestApp();
  });

  /** A SHIFT_BASED AZUBI, 38 h over Mon-Fri. */
  async function createAzubi(label: string): Promise<string> {
    const prisma = app.prisma;
    const user = await prisma.user.create({
      data: {
        email: `azubi-${label}-${suffix}@test.de`,
        passwordHash: await bcrypt.hash("test1234", 10),
        isActive: true,
      },
    });
    const emp = await prisma.employee.create({
      data: {
        tenantId,
        userId: user.id,
        employeeNumber: `AZ-${label}-${suffix}`,
        firstName: `Azubi${label}`,
        lastName: "Test",
        hireDate: new Date("2024-01-01"),
        classification: "AZUBI",
      },
    });
    await grantSystemRole(prisma, { tenantId, userId: user.id, role: "EMPLOYEE" });
    await prisma.workSchedule.create({
      data: {
        employeeId: emp.id,
        type: "SHIFT_BASED",
        weeklyHours: 38,
        mondayHours: 7.6,
        tuesdayHours: 7.6,
        wednesdayHours: 7.6,
        thursdayHours: 7.6,
        fridayHours: 7.6,
        saturdayHours: 0,
        sundayHours: 0,
        workDays: [1, 2, 3, 4, 5],
        validFrom: new Date("2024-01-01"),
      },
    });
    await prisma.overtimeAccount.create({ data: { employeeId: emp.id, balanceHours: 0 } });
    return emp.id;
  }

  /** The Wednesday Berufsschultag, written by a pattern or by hand. */
  async function seedBerufsschultag(employeeId: string, source: "PATTERN" | "MANUAL") {
    await app.prisma.absence.create({
      data: {
        employeeId,
        type: "VOCATIONAL_SCHOOL",
        startDate: dayOffset(2),
        endDate: dayOffset(2),
        days: 1,
        source,
        createdBy: "system",
      },
    });
  }

  async function seedLeave(
    employeeId: string,
    leaveTypeId: string,
    fromOffset: number,
    toOffset: number,
  ) {
    await app.prisma.leaveRequest.create({
      data: {
        employeeId,
        leaveTypeId,
        startDate: dayOffset(fromOffset),
        endDate: dayOffset(toOffset),
        status: "APPROVED",
        days: toOffset - fromOffset + 1,
      },
    });
  }

  async function getWeek(): Promise<WeekBody> {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/shifts/week?date=${weekMonday}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as WeekBody;
  }

  /** The four minute maps of one person, absent entries read as 0. */
  function maps(body: WeekBody, employeeId: string) {
    return {
      contractSoll: body.contractSollMinutesByEmp[employeeId],
      leave: body.leaveMinutesByEmp[employeeId] ?? 0,
      absence: body.absenceMinutesByEmp[employeeId] ?? 0,
      vocationalSchool: body.vocationalSchoolMinutesByEmp[employeeId] ?? 0,
    };
  }

  it("VACATION Mon-Fri over a Berufsschultag equals VACATION split into Mon-Tue + Thu-Fri", async () => {
    const spanning = await createAzubi("VS");
    const split = await createAzubi("VP");
    for (const id of [spanning, split]) await seedBerufsschultag(id, "PATTERN");
    await seedLeave(spanning, vacationTypeId, 0, 4);
    await seedLeave(split, vacationTypeId, 0, 1);
    await seedLeave(split, vacationTypeId, 3, 4);

    const body = await getWeek();
    const a = maps(body, spanning);
    const b = maps(body, split);

    // Hand-derived: base Soll 2280, leave relieves the four other days, the Berufsschultag stays.
    expect(b.contractSoll).toBe(DAY_SOLL_MIN);
    expect(b.leave).toBe(FOUR_DAYS_MIN);
    expect(b.absence).toBe(0);
    expect(b.vocationalSchool).toBeGreaterThan(0);
    expect(a).toEqual(b);

    // The cell display is unchanged: vacation still wins the Wednesday cell.
    const wednesday = body.availability.find(
      (c) => c.employeeId === spanning && c.date === dayOffset(2).toISOString().slice(0, 10),
    );
    expect(wednesday?.availability).toBe("vacation");
  });
});
