/**
 * Issue #1079 (D-06) - the leave planner shows a salon-scoped Betriebsurlaub as GESETZT row only on
 * the days the person's Stammsalon is a named salon (the same `shutdownAffectedRuns` rule the
 * booking uses); an unternehmensweit one keeps its single full-period row per person.
 *
 * Fixture: tenant one with salons A (the seed salon) and B, a plan of A for next year. Persons: PA
 * (homed in A all year), MV (A until 30 June, B from 1 July). Plan years are computed from the
 * tenant-local today; the shutdown days are fixed days inside that year. No person names.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp, seedTestData, cleanupTestData, createTestSalon } from "./setup";
import { getTenantTimezone, todayInTz } from "../contexts/working-time-account";

type PlannerRowDto = { kind: string; state: string; startDate: string; endDate: string };
type PlannerDto = { persons: Array<{ employeeId: string; rows: PlannerRowDto[] }> };

describe("Issue #1079 - the leave planner follows the Stammsalon per day for a salon-scoped Betriebsurlaub", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let year: number;
  let salonA: string;
  let salonB: string;
  let planId: string;
  let pa: string;
  let mv: string;

  async function person(label: string) {
    const user = await app.prisma.user.create({
      data: {
        email: `${label}-${crypto.randomBytes(3).toString("hex")}@example.invalid`,
        passwordHash: await bcrypt.hash("test1234", 4),
        isActive: true,
      },
    });
    const employee = await app.prisma.employee.create({
      data: {
        tenantId: data.tenant.id,
        userId: user.id,
        employeeNumber: `P${crypto.randomBytes(4).toString("hex")}`,
        firstName: label,
        lastName: "Plan1079",
        hireDate: new Date("2024-01-01"),
      },
    });
    return employee.id;
  }

  async function home(
    employeeId: string,
    salonId: string,
    validFrom: string,
    validUntil: string | null,
  ) {
    await app.prisma.employeeSalonAssignment.create({
      data: {
        tenantId: data.tenant.id,
        employeeId,
        salonId,
        kind: "HOME",
        validFrom: new Date(`${validFrom}T00:00:00Z`),
        validUntil: validUntil ? new Date(`${validUntil}T00:00:00Z`) : null,
        weekdays: [],
      },
    });
  }

  async function shutdown(
    name: string,
    start: string,
    end: string,
    salonIds: string[],
  ): Promise<void> {
    await app.prisma.companyShutdown.create({
      data: {
        tenantId: data.tenant.id,
        name,
        startDate: new Date(`${start}T00:00:00Z`),
        endDate: new Date(`${end}T00:00:00Z`),
        deductsFromVacation: true,
        salons: { create: salonIds.map((salonId) => ({ salonId })) },
      },
    });
  }

  async function shutdownRows(employeeId: string): Promise<Array<[string, string]>> {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/leave/plans/${planId}`,
      headers: { authorization: `Bearer ${data.adminToken}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    const dto = res.json() as PlannerDto;
    const found = dto.persons.find((p) => p.employeeId === employeeId);
    expect(found, "person in the planner").toBeDefined();
    return found!.rows
      .filter((row) => row.kind === "COMPANY_SHUTDOWN")
      .map((row): [string, string] => [row.startDate, row.endDate])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "lps1079");
    const tz = await getTenantTimezone(app.prisma, data.tenant.id);
    year = todayInTz(tz).getUTCFullYear() + 1;
    salonA = data.salonId;
    salonB = (await createTestSalon(app.prisma, data.tenant.id, { name: "Plan1079 B" })).id;

    pa = data.employee.id;
    mv = await person("mv");
    await home(pa, salonA, "2024-01-01", null);
    await home(mv, salonA, "2024-01-01", `${year}-06-30`);
    await home(mv, salonB, `${year}-07-01`, null);

    planId = (
      await app.prisma.leavePlan.create({
        data: {
          tenantId: data.tenant.id,
          salonId: salonA,
          year,
          openedByUserId: data.adminUser.id,
        },
      })
    ).id;

    await shutdown("Plan1079 wide", `${year}-03-01`, `${year}-03-03`, []);
    await shutdown("Plan1079 A", `${year}-06-29`, `${year}-07-02`, [salonA]);
    await shutdown("Plan1079 B", `${year}-09-07`, `${year}-09-08`, [salonB]);
  });

  afterAll(async () => {
    try {
      await app.prisma.leavePlan.deleteMany({ where: { tenantId: data.tenant.id } });
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("leave-plan-read-shutdown-salon-1079 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("a person homed in A all year gets the full wide row and the A row, none for the B shutdown", async () => {
    expect(await shutdownRows(pa)).toEqual([
      [`${year}-03-01`, `${year}-03-03`],
      [`${year}-06-29`, `${year}-07-02`],
    ]);
  });

  it("a person who moves from A to B gets the A row only for the A days and the B row for the B days", async () => {
    expect(await shutdownRows(mv)).toEqual([
      [`${year}-03-01`, `${year}-03-03`],
      [`${year}-06-29`, `${year}-06-30`],
      [`${year}-09-07`, `${year}-09-08`],
    ]);
  });
});
