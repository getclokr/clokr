/**
 * Issue #1142 - the roster Planungs-Soll (`GET /shifts/week`) relieves a SHIFT_BASED person's
 * approved leave exactly like the saldo core of the same week (#429, #1136).
 *
 * Before the fix the roster priced every leave row with the Ø-method of the legacy `workDays`
 * (sick Mon-Wed on a Tue-Fri contract took 3 x 570 although Monday is no usual workday and
 * Thursday / Friday carry planned shifts; the weekly cap was ignored). Since #1142 the roster calls
 * the saldo core's own `shiftBasedLeaveRelief()` through the Arbeitszeitkonto facade, so a ROSTER-
 * basis row (SICK, SICK_CHILD, SPECIAL) relieves the planned shift netto on a planned day and the
 * contractual Ø-day only on a usual workday otherwise, never more than the week's contract Soll.
 *
 * Every case pairs a hand-derived pin with the saldo core's whole-week Soll
 * (`computeWeekProgress().weekSollMinutes`, the oracle). Pre-fix values are named per case.
 *
 * Fixture A: SHIFT_BASED 38 h, contract 4 days (Ø-day 570, week contract Soll 2280), usual workdays
 * Tue-Fri, legacy `workDays` Mon-Fri (the placeholder that names Monday). Shifts: S = 07:45-18:00
 * (615 brutto, 45 min break, 570 netto), LONG = 07:45-18:30 (645 brutto, 45 min break, 600 netto).
 * The week is holiday-free and inside one calendar month (the saldo's SHIFT_BASED contract is
 * deliberately not holiday-reduced, #429 D-05, so parity is asserted on holiday-free weeks only).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import {
  getTestApp,
  closeTestApp,
  cleanupTestData,
  createTestSalon,
  grantSystemRole,
} from "./setup";
import { addDaysStr, holidayFreeMondayStr } from "./test-dates";
import { computeWeekProgress } from "../contexts/working-time-account";

const TZ = "Europe/Berlin";

type WeekBody = {
  contractSollMinutesByEmp: Record<string, number>;
  leaveMinutesByEmp: Record<string, number>;
  absenceMinutesByEmp: Record<string, number>;
};

/** Fixture A (see the header); Fixture B differs only in the Angabe (Mon-Fri). */
const FIXTURE_A = { usualWorkDays: [2, 3, 4, 5] };
const FIXTURE_B = { usualWorkDays: [1, 2, 3, 4, 5] };

describe("Issue #1142 - the planner Soll takes the saldo core's SHIFT_BASED leave relief", () => {
  let app: FastifyInstance;
  let tenantId: string;
  let salonId: string;
  let adminToken: string;
  let weekMonday: string;
  let suffix: string;
  const typeIds: Record<string, string> = {};

  function dayOffset(offset: number): Date {
    return new Date(addDaysStr(weekMonday, offset) + "T00:00:00Z");
  }

  beforeAll(async () => {
    app = await getTestApp();
    const prisma = app.prisma;
    suffix = "1142-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    // Holiday-free AND the whole week inside one calendar month.
    weekMonday = holidayFreeMondayStr(
      9,
      "NI",
      (m) => addDaysStr(m, 6).slice(0, 7) === m.slice(0, 7),
    );

    const tenant = await prisma.tenant.create({
      data: {
        name: `Issue 1142 Test ${suffix}`,
        slug: `issue-1142-${suffix}`,
        federalState: "NIEDERSACHSEN",
      },
    });
    tenantId = tenant.id;
    salonId = (await createTestSalon(prisma, tenantId)).id;
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

    for (const [code, name, requiresApproval] of [
      ["VACATION", "Urlaub", true],
      ["SICK", "Krank", false],
      ["SICK_CHILD", "Kind krank", false],
      ["SPECIAL", "Sonderurlaub", true],
    ] as const) {
      const t = await prisma.leaveType.create({
        data: { tenantId, code, name, isPaid: true, requiresApproval, color: "#3B82F6" },
      });
      typeIds[code] = t.id;
    }

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
      console.error("Issue 1142 test cleanup failed:", err);
    }
    await closeTestApp();
  });

  async function createPerson(label: string, fixture: { usualWorkDays: number[] }) {
    const prisma = app.prisma;
    const user = await prisma.user.create({
      data: {
        email: `p-${label}-${suffix}@test.de`,
        passwordHash: await bcrypt.hash("test1234", 10),
        isActive: true,
      },
    });
    const emp = await prisma.employee.create({
      data: {
        tenantId,
        userId: user.id,
        employeeNumber: `P-${label}-${suffix}`,
        firstName: `Person${label}`,
        lastName: "Test",
        hireDate: new Date("2024-01-01"),
      },
    });
    await grantSystemRole(prisma, { tenantId, userId: user.id, role: "EMPLOYEE" });
    await prisma.workSchedule.create({
      data: {
        employeeId: emp.id,
        type: "SHIFT_BASED",
        weeklyHours: 38,
        contractWorkDaysPerWeek: 4,
        usualWorkDays: fixture.usualWorkDays,
        workDays: [1, 2, 3, 4, 5], // legacy placeholder naming Monday
        mondayHours: 7.6,
        tuesdayHours: 7.6,
        wednesdayHours: 7.6,
        thursdayHours: 7.6,
        fridayHours: 7.6,
        saturdayHours: 0,
        sundayHours: 0,
        validFrom: new Date("2024-01-01"),
      },
    });
    await prisma.overtimeAccount.create({ data: { employeeId: emp.id, balanceHours: 0 } });
    return emp.id;
  }

  async function seedLeave(
    employeeId: string,
    code: string,
    fromOffset: number,
    toOffset: number,
  ): Promise<void> {
    await app.prisma.leaveRequest.create({
      data: {
        employeeId,
        leaveTypeId: typeIds[code]!,
        startDate: dayOffset(fromOffset),
        endDate: dayOffset(toOffset),
        status: "APPROVED",
        days: toOffset - fromOffset + 1,
      },
    });
  }

  async function seedShift(employeeId: string, offset: number, start: string, end: string) {
    await app.prisma.shift.create({
      data: { employeeId, salonId, date: dayOffset(offset), startTime: start, endTime: end },
    });
  }
  const S = (id: string, offset: number) => seedShift(id, offset, "07:45", "18:00"); // 570 netto
  const LONG = (id: string, offset: number) => seedShift(id, offset, "07:45", "18:30"); // 600 netto

  async function getWeek(): Promise<WeekBody> {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/shifts/week?date=${weekMonday}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as WeekBody;
  }

  /** The saldo core's whole-week Soll of the person - the oracle. */
  async function coreWeekSoll(employeeId: string): Promise<number> {
    const progress = await computeWeekProgress(
      app,
      employeeId,
      new Date(weekMonday + "T10:00:00Z"),
    );
    return progress!.weekSollMinutes;
  }

  /** Pin the route's leave minutes and Soll, and tie the Soll to the saldo core. */
  async function expectWeek(
    employeeId: string,
    body: WeekBody,
    pin: { leave: number | undefined; soll: number },
  ) {
    expect(body.leaveMinutesByEmp[employeeId]).toBe(pin.leave);
    expect(body.absenceMinutesByEmp[employeeId]).toBeUndefined();
    expect(body.contractSollMinutesByEmp[employeeId]).toBe(pin.soll);
    expect(body.contractSollMinutesByEmp[employeeId]).toBe(await coreWeekSoll(employeeId));
  }

  // T1-T3: the #1136 owner example for all three roster-basis codes. SICK Mon-Wed, shifts only on
  // Thu + Fri. Monday is no usual workday and has no shift -> 0; Tue + Wed take the O-day 570.
  // Pre-fix: leave 1710 (3 x 570), Soll 570.
  for (const [label, code] of [
    ["T1 SICK", "SICK"],
    ["T2 SICK_CHILD", "SICK_CHILD"],
    ["T3 SPECIAL", "SPECIAL"],
  ] as const) {
    it(`${label} Mon-Wed without a shift on those days -> 1140 / 1140 (pre-fix 1710 / 570)`, async () => {
      const id = await createPerson(code.replace("_", ""), FIXTURE_A);
      await seedLeave(id, code, 0, 2);
      await S(id, 3);
      await S(id, 4);
      await expectWeek(id, await getWeek(), { leave: 1140, soll: 1140 });
    });
  }

  // T4: the #1136 measured case: Tue + Wed fall back to the O-day, Thu + Fri relieve the planned
  // netto; the week room (2280 - 1140) is not binding. Pre-fix: leave 2280 (4 x 570 by chance),
  // Soll 0 is the same - the pin guards the equality with the core.
  it("T4 SICK Tue-Fri with shifts Thu + Fri -> leave 2280, Soll 0", async () => {
    const id = await createPerson("T4", FIXTURE_A);
    await seedLeave(id, "SICK", 1, 4);
    await S(id, 3);
    await S(id, 4);
    await expectWeek(id, await getWeek(), { leave: 2280, soll: 0 });
  });

  // T5: a planned shift wins on a usual day. Pre-fix: 570 / 1710.
  it("T5 SICK Thu on a 600 min shift -> leave 600, Soll 1680 (pre-fix 570 / 1710)", async () => {
    const id = await createPerson("T5", FIXTURE_A);
    await seedLeave(id, "SICK", 3, 3);
    await LONG(id, 3);
    await S(id, 4);
    await expectWeek(id, await getWeek(), { leave: 600, soll: 1680 });
  });

  // T6: a planned shift wins on a NON-usual day too. Pre-fix: 570 / 1710.
  it("T6 SICK Mon (not a usual day) on a 600 min shift -> leave 600, Soll 1680 (pre-fix 570 / 1710)", async () => {
    const id = await createPerson("T6", FIXTURE_A);
    await seedLeave(id, "SICK", 0, 0);
    await LONG(id, 0);
    await expectWeek(id, await getWeek(), { leave: 600, soll: 1680 });
  });

  // T7: a non-usual day without a shift relieves nothing. Pre-fix: 570 / 1710.
  it("T7 SICK Mon without a shift -> no leave key, Soll 2280 (pre-fix 570 / 1710)", async () => {
    const id = await createPerson("T7", FIXTURE_A);
    await seedLeave(id, "SICK", 0, 0);
    await expectWeek(id, await getWeek(), { leave: undefined, soll: 2280 });
  });

  // T8: the weekly cap. Vacation Mon-Tue relieves 2 x 570 = 1140; sick Wed-Fri would add 1710 but the
  // week's room is 2280 - 1140 = 1140. Pre-fix: leave 2850 (5 x 570), over the week's contract.
  it("T8 VACATION Mon-Tue + SICK Wed-Fri without shifts is capped at the week -> 2280 / 0 (pre-fix 2850)", async () => {
    const id = await createPerson("T8", FIXTURE_B);
    await seedLeave(id, "VACATION", 0, 1);
    await seedLeave(id, "SICK", 2, 4);
    await expectWeek(id, await getWeek(), { leave: 2280, soll: 0 });
  });

  // T9 (GA-1): vacation goes through the same rule - a fragment week counts the usual Tue + Wed
  // only. Pre-fix: 1710 / 570.
  it("T9 VACATION Mon-Wed on Fixture A -> 1140 / 1140 (pre-fix 1710 / 570)", async () => {
    const id = await createPerson("T9", FIXTURE_A);
    await seedLeave(id, "VACATION", 0, 2);
    await expectWeek(id, await getWeek(), { leave: 1140, soll: 1140 });
  });
});

// ── One rule: the roster reaches the saldo core's relief only through the facade ───────────────
//
// What this cannot see: a re-implementation of the rule under another name. Review has to catch a
// creative workaround.
describe("Issue #1142 - one rule, reached through the Arbeitszeitkonto facade", () => {
  const SRC = join(__dirname, "..", "contexts");
  const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");

  const RULE_KERNELS = [
    "leaveDaysPerWeek",
    "shiftBasedLeaveCreditByDate",
    "capToWeekContractRoom",
    "leaveCreditBasisForCode",
    "rosterShiftBreakMinutes",
    "usualWorkDaysFrom",
    "contractWorkDaysPerWeekFrom",
  ];

  const parse = (source: string) =>
    ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);

  function callsOf(source: string, name: string): ts.CallExpression[] {
    const found: ts.CallExpression[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) {
        found.push(n);
      }
      ts.forEachChild(n, visit);
    };
    visit(parse(source));
    return found;
  }

  const kernelCalls = (source: string) =>
    RULE_KERNELS.flatMap((k) => callsOf(source, k).map(() => k));

  it("G1 roster-leave-soll.ts imports the relief and the planned netto from the facade and calls both", () => {
    const source = read("scheduling", "roster-leave-soll.ts");
    const sf = parse(source);
    const imported = new Set<string>();
    sf.forEachChild((n) => {
      if (
        ts.isImportDeclaration(n) &&
        ts.isStringLiteral(n.moduleSpecifier) &&
        n.moduleSpecifier.text === "../working-time-account" &&
        n.importClause?.namedBindings &&
        ts.isNamedImports(n.importClause.namedBindings)
      ) {
        for (const e of n.importClause.namedBindings.elements) imported.add(e.name.text);
      }
    });
    expect(imported.has("shiftBasedLeaveRelief")).toBe(true);
    expect(imported.has("rosterPlannedNettoByDate")).toBe(true);
    expect(callsOf(source, "shiftBasedLeaveRelief").length).toBeGreaterThanOrEqual(1);
    expect(callsOf(source, "rosterPlannedNettoByDate").length).toBeGreaterThanOrEqual(1);
  });

  it("G2 neither the route file nor the glue calls a kernel of the rule itself", () => {
    expect(kernelCalls(read("scheduling", "api", "shifts.ts"))).toEqual([]);
    expect(kernelCalls(read("scheduling", "roster-leave-soll.ts"))).toEqual([]);
  });

  it("G2 positive control: the scanner reports a kernel call it is shown", () => {
    const synthetic = `${read("scheduling", "roster-leave-soll.ts")}\nleaveDaysPerWeek([], 5, new Set());\n`;
    expect(kernelCalls(synthetic)).toEqual(["leaveDaysPerWeek"]);
  });

  it("G3 shifts.ts calls the glue exactly once, before the leave loop that prices the Ø-days", () => {
    const source = read("scheduling", "api", "shifts.ts");
    const calls = callsOf(source, "shiftBasedLeaveMinutesByEmp");
    expect(calls).toHaveLength(1);
    let loopPos = -1;
    const visit = (n: ts.Node): void => {
      if (
        ts.isForOfStatement(n) &&
        ts.isCallExpression(n.expression) &&
        ts.isIdentifier(n.expression.expression) &&
        n.expression.expression.text === "sortForSollDedup" &&
        n.expression.arguments[0]?.getText() === "leaveForSoll"
      ) {
        loopPos = n.getStart();
      }
      ts.forEachChild(n, visit);
    };
    visit(parse(source));
    expect(loopPos).toBeGreaterThan(-1);
    expect(calls[0]!.getStart()).toBeLessThan(loopPos);
  });

  it("G4 closeEmployeeMonth calls the relief and the planned netto exactly once each", () => {
    const source = read("working-time-account", "close-employee-month.ts");
    let fn: ts.FunctionDeclaration | undefined;
    parse(source).forEachChild((n) => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === "closeEmployeeMonth") fn = n;
    });
    expect(fn).toBeDefined();
    const inside = (name: string) => callsOf(fn!.getText(), name).length;
    expect(inside("shiftBasedLeaveRelief")).toBe(1);
    expect(inside("rosterPlannedNettoByDate")).toBe(1);
  });
});
