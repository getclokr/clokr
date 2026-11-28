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
 *
 * Since Issue #1142 a SHIFT_BASED person's leave rows are priced by the saldo core's own relief
 * (`shiftBasedLeaveRelief()`); the Berufsschule priority described here is unchanged.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
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
  let sickTypeId: string;

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
    const sick = await prisma.leaveType.create({
      data: {
        tenantId,
        code: "SICK",
        name: "Krank",
        isPaid: true,
        requiresApproval: false,
        color: "#EF4444",
      },
    });
    sickTypeId = sick.id;

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

  async function seedOtherAbsence(employeeId: string, fromOffset: number, toOffset: number) {
    await app.prisma.absence.create({
      data: {
        employeeId,
        type: "OTHER",
        startDate: dayOffset(fromOffset),
        endDate: dayOffset(toOffset),
        days: toOffset - fromOffset + 1,
        source: "MANUAL",
        createdBy: "system",
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

  it("SICK leave over a Berufsschultag equals the split rows; the cell still reads sick", async () => {
    const spanning = await createAzubi("SS");
    const split = await createAzubi("SP");
    for (const id of [spanning, split]) await seedBerufsschultag(id, "PATTERN");
    await seedLeave(spanning, sickTypeId, 0, 4);
    await seedLeave(split, sickTypeId, 0, 1);
    await seedLeave(split, sickTypeId, 3, 4);

    const body = await getWeek();
    const a = maps(body, spanning);
    const b = maps(body, split);

    expect(b.contractSoll).toBe(DAY_SOLL_MIN);
    expect(b.leave).toBe(FOUR_DAYS_MIN);
    expect(b.absence).toBe(0);
    expect(b.vocationalSchool).toBeGreaterThan(0);
    expect(a).toEqual(b);

    const wednesday = body.availability.find(
      (c) => c.employeeId === spanning && c.date === dayOffset(2).toISOString().slice(0, 10),
    );
    expect(wednesday?.availability).toBe("sick");
  });

  it("an OTHER absence over a Berufsschultag equals the split rows; the cell still reads vocational_school", async () => {
    const spanning = await createAzubi("OS");
    const split = await createAzubi("OP");
    // MANUAL Berufsschultag here, PATTERN above: both sources are a Berufsschultag.
    for (const id of [spanning, split]) await seedBerufsschultag(id, "MANUAL");
    await seedOtherAbsence(spanning, 0, 4);
    await seedOtherAbsence(split, 0, 1);
    await seedOtherAbsence(split, 3, 4);

    const body = await getWeek();
    const a = maps(body, spanning);
    const b = maps(body, split);

    expect(b.contractSoll).toBe(DAY_SOLL_MIN);
    expect(b.absence).toBe(FOUR_DAYS_MIN);
    expect(b.leave).toBe(0);
    expect(b.vocationalSchool).toBeGreaterThan(0);
    expect(a).toEqual(b);

    const wednesday = body.availability.find(
      (c) => c.employeeId === spanning && c.date === dayOffset(2).toISOString().slice(0, 10),
    );
    expect(wednesday?.availability).toBe("vocational_school");
  });

  it("control: a Berufsschultag alone keeps the full week Soll and the same credit as every other case", async () => {
    const control = await createAzubi("CT");
    const spanning = await createAzubi("CS");
    await seedBerufsschultag(control, "PATTERN");
    await seedBerufsschultag(spanning, "PATTERN");
    await seedLeave(spanning, vacationTypeId, 0, 4);

    const body = await getWeek();
    const c = maps(body, control);

    expect(c.contractSoll).toBe(2280);
    expect(c.leave).toBe(0);
    expect(c.absence).toBe(0);
    // The credit does not depend on which row wins the cell.
    expect(maps(body, spanning).vocationalSchool).toBe(c.vocationalSchool);
    expect(c.vocationalSchool).toBeGreaterThan(0);
  });

  // A row that runs past the visible week is clipped at the tenant-local Sunday end. The raw UTC
  // Sunday 23:59:59.999Z is already Monday in Europe/Berlin, so an unclipped bound relieved one
  // extra day of the NEXT week.
  // Issue #1142: SHIFT_BASED leave is priced by the saldo core's relief, i.e. the #429 contract week
  // (Thu, Fri and Sat count, 456 each); the clip is still proven - nothing of next Monday or
  // Tuesday is counted, which would push the figure past 1368.
  it("leave running past Sunday relieves only the visible days (Thu + Fri + Sat = 1368)", async () => {
    const person = await createAzubi("CL");
    await seedLeave(person, vacationTypeId, 3, 8); // Thu .. next Tue

    const body = await getWeek();
    const m = maps(body, person);

    expect(m.leave).toBe(3 * DAY_SOLL_MIN); // 1368
    expect(m.absence).toBe(0);
    expect(m.contractSoll).toBe(2280 - 1368); // 912
  });

  it("an absence running past Sunday relieves only the visible days (Thu + Fri = 912)", async () => {
    const person = await createAzubi("CA");
    await seedOtherAbsence(person, 3, 8);

    const body = await getWeek();
    const m = maps(body, person);

    expect(m.absence).toBe(2 * DAY_SOLL_MIN);
    expect(m.leave).toBe(0);
    expect(m.contractSoll).toBe(2280 - 912);
  });
});

// ── AC2: the planner reaches the Berufsschule priority only through the facade ────────────────
//
// What this cannot see: an alias of the set (`const s = sollExclusion(id)` handed on under another
// name) or a re-implementation of the rule that never names `bsDayPriority`. Review has to catch a
// creative workaround.
describe("Issue #1089 AC2 - the planner reaches the Berufsschule priority only through the facade", () => {
  const SOURCE_PATH = join(__dirname, "..", "contexts", "scheduling", "api", "shifts.ts");

  type Scan = {
    importsRule: boolean;
    ruleCalls: Array<{ line: number; viaExclusionInSollExclusion: boolean }>;
    priceCalls: Array<{ line: number; viaSollExclusion: boolean }>;
  };

  function scan(source: string): Scan {
    const sf = ts.createSourceFile("shifts.ts", source, ts.ScriptTarget.Latest, true);
    const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    const out: Scan = { importsRule: false, ruleCalls: [], priceCalls: [] };
    const isCallOf = (n: ts.Node | undefined, name: string): n is ts.CallExpression =>
      !!n && ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name;
    const visit = (n: ts.Node): void => {
      if (
        ts.isImportDeclaration(n) &&
        ts.isStringLiteral(n.moduleSpecifier) &&
        n.moduleSpecifier.text === "../../working-time-account" &&
        n.importClause?.namedBindings &&
        ts.isNamedImports(n.importClause.namedBindings) &&
        n.importClause.namedBindings.elements.some((e) => e.name.text === "bsDayPriority")
      )
        out.importsRule = true;
      if (isCallOf(n, "bsDayPriority")) {
        const access = n.parent;
        const outer = access?.parent;
        const viaExclusion =
          ts.isPropertyAccessExpression(access) &&
          access.expression === n &&
          access.name.text === "exclusion" &&
          ts.isCallExpression(outer) &&
          outer.expression === access;
        let inFn = false;
        for (let up: ts.Node | undefined = n; up; up = up.parent) {
          if (ts.isFunctionDeclaration(up) && up.name?.text === "sollExclusion") inFn = true;
        }
        out.ruleCalls.push({ line: lineOf(n), viaExclusionInSollExclusion: viaExclusion && inFn });
      }
      if (isCallOf(n, "calcLeaveAbsenceMinutesTz")) {
        const options = n.arguments.find(ts.isObjectLiteralExpression);
        const prop = options?.properties.find(
          (p): p is ts.PropertyAssignment =>
            ts.isPropertyAssignment(p) &&
            ts.isIdentifier(p.name) &&
            p.name.text === "excludeHolidays",
        );
        out.priceCalls.push({
          line: lineOf(n),
          viaSollExclusion: !!prop && isCallOf(prop.initializer, "sollExclusion"),
        });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  }

  const source = readFileSync(SOURCE_PATH, "utf8");

  it("imports the rule from the Arbeitszeitkonto facade and calls it exactly once, inside sollExclusion", () => {
    const found = scan(source);
    expect(found.importsRule).toBe(true);
    expect(found.ruleCalls).toHaveLength(1);
    expect(found.ruleCalls[0].viaExclusionInSollExclusion).toBe(true);
  });

  it("every calcLeaveAbsenceMinutesTz call takes its excludeHolidays from sollExclusion()", () => {
    const found = scan(source);
    // floor: perDayLeaveMinutes, the leave loop and the absence loop
    expect(found.priceCalls.length).toBeGreaterThanOrEqual(3);
    expect(found.priceCalls.filter((c) => !c.viaSollExclusion).map((c) => c.line)).toEqual([]);
  });

  it("positive control: a calcLeaveAbsenceMinutesTz call that takes the bare claim set is reported", () => {
    const synthetic = `${source}\ncalcLeaveAbsenceMinutesTz(s, a, b, tz, { excludeHolidays: claimSetFor(x) });\n`;
    const violations = scan(synthetic).priceCalls.filter((c) => !c.viaSollExclusion);
    expect(violations).toHaveLength(1);
  });
});
