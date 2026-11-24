/**
 * Issue #1011 (a) — the roster nets a planned shift with the SAME break rule as the recording.
 *
 * A person under 18 on the shift date works under § 11 JArbSchG (§ 18 Abs. 2 ArbZG): more than 6 h
 * means a 60 min Ruhepause, not the adult tenant setting (30 min, § 4 ArbZG). Four shifts
 * 08:00-17:00 therefore net to 4 x 8:00 = 32 h for a 16-year-old, where the roster showed 34 h.
 *
 * Proves, on `GET /shifts/week` and `GET /shifts/range`:
 *   - minor (born 2010-05-01): break 4 x 60 = 240 min; adult: 4 x 30 = 120 min (unchanged);
 *   - the age is decided per shift date: a person who turns 18 on Wed 18.11.2026 gets 60 min on
 *     Mon and Tue and the adult 30 min from the birthday on (60 + 60 + 30 + 30 = 180);
 *   - `/range` nets each of the minor's shifts to 480 (adult 510), brutto unchanged;
 *   - T-1011-01: the response of `/week` never carries a birth date.
 *
 * Synthetic names only (CLAUDE.md PII rule).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp, seedTestData, cleanupTestData, grantSystemRole } from "./setup";

const PASSWORD = "test1234";
const DAYS = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"]; // Mon..Thu

describe("Issue #1011 — planned shift netto uses the recording's break rule", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let minorId: string;
  let adultId: string;
  let birthdayId: string;

  async function mkPerson(label: string, birthDate: string): Promise<string> {
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
        lastName: "Break1011",
        hireDate: new Date("2024-09-01T00:00:00Z"),
        birthDate: new Date(`${birthDate}T00:00:00Z`),
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
        type: "FIXED_SCHEDULE",
        weeklyHours: 40,
        mondayHours: 8,
        tuesdayHours: 8,
        wednesdayHours: 8,
        thursdayHours: 8,
        fridayHours: 8,
        saturdayHours: 0,
        sundayHours: 0,
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
    for (const date of DAYS) {
      await app.prisma.shift.create({
        data: {
          employeeId: employee.id,
          salonId: data.salonId,
          date: new Date(`${date}T00:00:00Z`),
          startTime: "08:00",
          endTime: "17:00",
        },
      });
    }
    return employee.id;
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "mb1011");
    // Tenant defaults 30 / 45, no per-person override (the schema defaults; set explicitly for the reader).
    await app.prisma.tenantConfig.update({
      where: { tenantId: data.tenant.id },
      data: { defaultBreakOver6h: 30, defaultBreakOver9h: 45 },
    });
    minorId = await mkPerson("Minor", "2010-05-01");
    adultId = await mkPerson("Adult", "1990-01-01");
    birthdayId = await mkPerson("Birthday", "2008-11-18"); // turns 18 on Wed 18.11.2026
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("shift-plan-minor-break-1011 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("GET /shifts/week: break minutes per person follow the age on each shift date", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/shifts/week?date=2026-11-16",
      headers: { authorization: `Bearer ${data.adminToken}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as { shiftBreakMinutesByEmp: Record<string, number> };
    // 4 x 08:00-17:00: a 16-year-old nets 8:00 per shift -> 4 x 60 min break (32 h planned, not 34 h)
    expect(body.shiftBreakMinutesByEmp[minorId]).toBe(240);
    expect(body.shiftBreakMinutesByEmp[adultId]).toBe(120);
    // Mon + Tue still a minor (60 + 60), Wed (the 18th birthday) + Thu adult (30 + 30)
    expect(body.shiftBreakMinutesByEmp[birthdayId]).toBe(180);
    // T-1011-01: a birth date never leaves the API
    expect(JSON.stringify(body)).not.toContain("birthDate");
  });

  it("GET /shifts/range: durationMinNetto is 480 for the minor, 510 for the adult, brutto unchanged", async () => {
    const read = async (employeeId: string) => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/shifts/range?from=2026-11-16&to=2026-11-22&employeeId=${employeeId}`,
        headers: { authorization: `Bearer ${data.adminToken}` },
      });
      expect(res.statusCode, res.body).toBe(200);
      const rows = JSON.parse(res.body) as Array<{
        date: string;
        durationMin: number;
        durationMinNetto: number;
      }>;
      return [...rows].sort((a, b) => a.date.localeCompare(b.date));
    };

    const minor = await read(minorId);
    expect(minor.map((r) => r.date)).toEqual(DAYS);
    expect(minor.map((r) => r.durationMin)).toEqual([540, 540, 540, 540]);
    expect(minor.map((r) => r.durationMinNetto)).toEqual([480, 480, 480, 480]);

    const adult = await read(adultId);
    expect(adult.map((r) => r.durationMin)).toEqual([540, 540, 540, 540]);
    expect(adult.map((r) => r.durationMinNetto)).toEqual([510, 510, 510, 510]);

    const birthday = await read(birthdayId);
    expect(birthday.map((r) => r.durationMinNetto)).toEqual([480, 480, 510, 510]);
  });
});
