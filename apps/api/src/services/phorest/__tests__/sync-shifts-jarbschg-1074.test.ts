// Issue #1074 — the Phorest shift sync reports § 8 / § 12 JArbSchG findings for minors.
// Phorest leads: the shift is stored unchanged, the planners (by reach) are notified, never the
// birth date. Run via `pnpm --filter @clokr/api exec vitest run <file>` after `test:setup`.

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { getTestApp, grantSystemRole, soleNotification } from "../../../__tests__/setup";
import { normalizeRolePermissions, roleNameKey } from "../../../contexts/platform";
import { syncPhorestShifts } from "../sync-shifts";
import {
  seedPhorestTenant,
  cleanupPhorestTenant,
  addCoupledSalon,
  MAPPED_STAFF_ID,
  type PhorestSeed,
} from "./helpers";
import staffFixture from "./fixtures/staff.json";

const originalFetch = global.fetch;

// Monday 2026-07-27 .. Sunday 2026-08-02; the literal dates are safe, the sync reads "today" only
// for the default window.
const WEEK_WINDOW = { startDate: "2026-07-27", endDate: "2026-08-02" };
const TYPE = "SHIFT_JARBSCHG_VIOLATION";

interface Slot {
  date: string;
  start: string;
  end: string;
}

/** Worktimetable body of the mapped staff member with WORKING slots; "HH:mm" in, "HH:mm:ss" out. */
function worktimetables(slots: Slot[]): unknown {
  return {
    _embedded: {
      workTimeTables: [
        {
          staffId: MAPPED_STAFF_ID,
          branchId: "branch-1",
          timeSlots: slots.map((s) => ({
            date: s.date,
            startTime: `${s.start}:00`,
            endTime: `${s.end}:00`,
            type: "WORKING",
          })),
        },
      ],
    },
    page: { size: 200, totalElements: 1, totalPages: 1, number: 0 },
  };
}

function mockPhorestBody(body: unknown): void {
  global.fetch = vi.fn(async (url: string | URL) => {
    const u = url.toString();
    const payload = u.includes("worktimetable") ? body : staffFixture;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

async function runSync(
  app: FastifyInstance,
  seed: PhorestSeed,
  slots: Slot[],
  window: { startDate: string; endDate: string } = WEEK_WINDOW,
) {
  mockPhorestBody(worktimetables(slots));
  return syncPhorestShifts(app, seed.tenantId, seed.target, window);
}

/** A custom role holding only shift:plan:ZUGEWIESEN, assigned with SALONS scope. */
async function createSalonsPlanner(
  app: FastifyInstance,
  seed: PhorestSeed,
  label: string,
  salonIds: string[],
): Promise<string> {
  const userId = await createUserInTenant(app, seed, label);
  const name = `Planer1074 ${label} ${Math.random().toString(36).slice(2, 6)}`;
  const role = await app.prisma.accessRole.create({
    data: {
      tenantId: seed.tenantId,
      name,
      nameKey: roleNameKey(name),
      permissions: normalizeRolePermissions(["shift:plan:ZUGEWIESEN"]),
    },
  });
  await app.prisma.roleAssignment.create({
    data: {
      tenantId: seed.tenantId,
      userId,
      accessRoleId: role.id,
      scopeType: "SALONS",
      salonIds,
      employeeIds: [],
    },
  });
  return userId;
}

async function createPlanner(
  app: FastifyInstance,
  seed: PhorestSeed,
  label: string,
  role: "MANAGER" | "EMPLOYEE" = "MANAGER",
): Promise<string> {
  const userId = await createUserInTenant(app, seed, label);
  await grantSystemRole(app.prisma, { tenantId: seed.tenantId, userId, role });
  return userId;
}

async function createUserInTenant(
  app: FastifyInstance,
  seed: PhorestSeed,
  label: string,
): Promise<string> {
  const stamp = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const user = await app.prisma.user.create({
    data: {
      email: `planner-1074-${stamp}@test.de`,
      passwordHash: await bcrypt.hash("test1234", 4),
      isActive: true,
    },
  });
  await app.prisma.employee.create({
    data: {
      tenantId: seed.tenantId,
      userId: user.id,
      employeeNumber: `P1074-${stamp}`,
      firstName: "Pia",
      lastName: "Planerin",
      hireDate: new Date("2024-01-01"),
    },
  });
  return user.id;
}

async function setBirthDate(
  app: FastifyInstance,
  employeeId: string,
  birthDate: string | null,
): Promise<void> {
  await app.prisma.employee.update({
    where: { id: employeeId },
    data: { birthDate: birthDate ? new Date(`${birthDate}T00:00:00Z`) : null },
  });
}

async function findingsOf(app: FastifyInstance, userId: string) {
  return app.prisma.notification.findMany({
    where: { userId, type: TYPE },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

describe("Issue #1074 — Phorest import reports § 8 / § 12 JArbSchG for minors", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const THURSDAY_LONG: Slot = { date: "2026-07-30", start: "08:00", end: "18:00" };

  it("imports a minor's 9-hour day unchanged and notifies the planner once, idempotently", async () => {
    const seed = await seedPhorestTenant(app, "jas-import");
    try {
      await setBirthDate(app, seed.mappedEmployeeId, "2010-03-01");
      const plannerId = await createPlanner(app, seed, "mgr");

      const first = await runSync(app, seed, [THURSDAY_LONG]);
      expect(first.status).toBe("SUCCESS");
      expect(first.created).toBe(1);

      const shifts = await app.prisma.shift.findMany({
        where: { employeeId: seed.mappedEmployeeId },
      });
      expect(shifts).toHaveLength(1);
      expect(shifts[0].startTime).toBe("08:00");
      expect(shifts[0].endTime).toBe("18:00");
      expect(shifts[0].origin).toBe("PHOREST");
      expect(shifts[0].deletedAt).toBeNull();

      const n = await soleNotification(app.prisma, { where: { userId: plannerId, type: TYPE } });
      expect(n.title).toContain("Erika Musterfrau");
      expect(n.message).toContain("30.7.2026");
      expect(n.message).toContain("9:00 Stunden");
      expect(n.message).toContain("8 Stunden");
      expect(n.message).toContain("§ 8");
      expect(n.link).toBe("/shifts");
      expect(n.relatedType).toBe("ShiftJarbschgWeek");
      expect(n.relatedId).toBe(`${seed.mappedEmployeeId}:2026-07-27`);

      // The same plan again: the open finding is not repeated.
      const second = await runSync(app, seed, [THURSDAY_LONG]);
      expect(second.status).toBe("SUCCESS");
      expect(await findingsOf(app, plannerId)).toHaveLength(1);
    } finally {
      await cleanupPhorestTenant(app, seed.tenantId);
    }
  });

  it("never carries the birth date or the age in any notification text", async () => {
    const seed = await seedPhorestTenant(app, "jas-privacy");
    try {
      await setBirthDate(app, seed.mappedEmployeeId, "2010-03-01");
      const plannerId = await createPlanner(app, seed, "mgr");
      await runSync(app, seed, [THURSDAY_LONG]);

      const users = await app.prisma.user.findMany({
        where: { employee: { tenantId: seed.tenantId } },
        select: { id: true },
      });
      const rows = await app.prisma.notification.findMany({
        where: { userId: { in: users.map((u) => u.id) } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      expect(rows.some((r) => r.userId === plannerId && r.type === TYPE)).toBe(true);
      for (const r of rows) {
        const text = `${r.title} ${r.message} ${r.link ?? ""}`;
        for (const forbidden of [
          "2010-03-01",
          "01.03.2010",
          "1.3.2010",
          "birthDate",
          "Geburt",
          "Jahre",
        ]) {
          expect(text).not.toContain(forbidden);
        }
      }
    } finally {
      await cleanupPhorestTenant(app, seed.tenantId);
    }
  });

  it("controls: an adult on the day (18th birthday itself) and a missing birth date report nothing", async () => {
    const seed = await seedPhorestTenant(app, "jas-control");
    try {
      const plannerId = await createPlanner(app, seed, "mgr");

      await setBirthDate(app, seed.mappedEmployeeId, "2008-07-27");
      await runSync(app, seed, [THURSDAY_LONG]);
      expect(await findingsOf(app, plannerId)).toHaveLength(0);

      await setBirthDate(app, seed.mappedEmployeeId, null);
      await runSync(app, seed, [THURSDAY_LONG]);
      expect(await findingsOf(app, plannerId)).toHaveLength(0);
    } finally {
      await cleanupPhorestTenant(app, seed.tenantId);
    }
  });

  it("adopt: a legacy Phorest row is updated in place and the padded times are reported", async () => {
    const seed = await seedPhorestTenant(app, "jas-adopt");
    try {
      await app.prisma.tenantConfig.update({
        where: { tenantId: seed.tenantId },
        data: { phorestPrepMinutes: 30, phorestWrapupMinutes: 30 },
      });
      await setBirthDate(app, seed.mappedEmployeeId, "2010-03-01");
      const plannerId = await createPlanner(app, seed, "mgr");
      await app.prisma.shift.create({
        data: {
          employeeId: seed.mappedEmployeeId,
          salonId: seed.salonId,
          date: new Date("2026-07-30"),
          startTime: "08:00",
          endTime: "17:00",
          origin: "MANUAL",
          label: "Phorest",
        },
      });

      const res = await runSync(app, seed, [{ date: "2026-07-30", start: "08:00", end: "17:00" }]);
      expect(res.status).toBe("SUCCESS");
      expect(res.updated).toBe(1);
      expect(res.created).toBe(0);

      const rows = await app.prisma.shift.findMany({
        where: { employeeId: seed.mappedEmployeeId, deletedAt: null },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].origin).toBe("PHOREST");
      expect(rows[0].startTime).toBe("07:30");
      expect(rows[0].endTime).toBe("17:30");

      const n = await soleNotification(app.prisma, { where: { userId: plannerId, type: TYPE } });
      expect(n.message).toContain("30.7.2026");
      expect(n.message).toContain("9:00 Stunden");
    } finally {
      await cleanupPhorestTenant(app, seed.tenantId);
    }
  });

  it("§ 12: a split day over 10 hours Schichtzeit is reported once, stored unchanged", async () => {
    const seed = await seedPhorestTenant(app, "jas-s12");
    try {
      await setBirthDate(app, seed.mappedEmployeeId, "2010-03-01");
      const plannerId = await createPlanner(app, seed, "mgr");
      const res = await runSync(app, seed, [
        { date: "2026-07-30", start: "08:00", end: "12:00" },
        { date: "2026-07-30", start: "15:00", end: "19:00" },
      ]);
      expect(res.created).toBe(2);

      const n = await soleNotification(app.prisma, { where: { userId: plannerId, type: TYPE } });
      expect(n.message).toContain("Schichtzeit");
      expect(n.message).toContain("10 Stunden");
      expect(n.message).toContain("§ 12");
      expect(n.message).not.toContain("Weitere Verstöße");
    } finally {
      await cleanupPhorestTenant(app, seed.tenantId);
    }
  });

  it("weekly: 42:30 over Mon-Fri is reported, exactly 40:00 is not", async () => {
    const seed = await seedPhorestTenant(app, "jas-week");
    try {
      await setBirthDate(app, seed.mappedEmployeeId, "2010-03-01");
      const plannerId = await createPlanner(app, seed, "mgr");
      const days = ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31"];

      await runSync(
        app,
        seed,
        days.map((date) => ({ date, start: "08:00", end: "17:00" })),
      );
      expect(await findingsOf(app, plannerId)).toHaveLength(0);

      await runSync(
        app,
        seed,
        days.map((date) => ({ date, start: "08:00", end: "17:30" })),
      );
      const n = await soleNotification(app.prisma, { where: { userId: plannerId, type: TYPE } });
      expect(n.message).toContain("40 Stunden");
      expect(n.message).toContain("27.7.");
    } finally {
      await cleanupPhorestTenant(app, seed.tenantId);
    }
  });

  it("several findings of a week arrive as one notification naming the further ones", async () => {
    const seed = await seedPhorestTenant(app, "jas-multi");
    try {
      await setBirthDate(app, seed.mappedEmployeeId, "2010-03-01");
      const plannerId = await createPlanner(app, seed, "mgr");
      await runSync(app, seed, [{ date: "2026-07-30", start: "07:00", end: "18:30" }]);

      const n = await soleNotification(app.prisma, { where: { userId: plannerId, type: TYPE } });
      expect(n.message.indexOf("Die geplante Arbeitszeit am 30.7.2026")).toBe(0);
      expect(n.message).toContain("Weitere Verstöße in dieser Woche: 30.7.2026 (Schichtzeit)");
    } finally {
      await cleanupPhorestTenant(app, seed.tenantId);
    }
  });

  it("Issue #1106 — § 18: a 16-year-old's Phorest shift on a holiday and on 24 December after 14:00 is reported, an adult's is not", async () => {
    const seed = await seedPhorestTenant(app, "jas-1106");
    try {
      const plannerId = await createPlanner(app, seed, "mgr");
      await setBirthDate(app, seed.mappedEmployeeId, "2010-03-01");

      // Tag der Deutschen Einheit (Saturday 03.10.2026), a holiday in every Bundesland.
      const holidayWindow = { startDate: "2026-09-28", endDate: "2026-10-04" };
      const holidayRun = await runSync(
        app,
        seed,
        [{ date: "2026-10-03", start: "10:00", end: "14:00" }],
        holidayWindow,
      );
      expect(holidayRun.status).toBe("SUCCESS");
      const stored = await app.prisma.shift.findMany({
        where: { employeeId: seed.mappedEmployeeId },
      });
      expect(stored).toHaveLength(1);
      expect(stored[0].startTime).toBe("10:00");
      expect(stored[0].endTime).toBe("14:00");
      expect(stored[0].origin).toBe("PHOREST");
      expect(stored[0].deletedAt).toBeNull();
      const holiday = await soleNotification(app.prisma, {
        where: { userId: plannerId, type: TYPE },
      });
      expect(holiday.message).toContain("3.10.2026");
      expect(holiday.message).toContain("(Tag der Deutschen Einheit)");
      expect(holiday.message).toContain("§ 18 Abs. 1 JArbSchG");

      // 24 December after 14:00 in another week.
      await app.prisma.notification.deleteMany({ where: { userId: plannerId } });
      const eveRun = await runSync(
        app,
        seed,
        [{ date: "2026-12-24", start: "08:00", end: "16:00" }],
        { startDate: "2026-12-21", endDate: "2026-12-27" },
      );
      expect(eveRun.status).toBe("SUCCESS");
      const eve = await soleNotification(app.prisma, { where: { userId: plannerId, type: TYPE } });
      expect(eve.message).toContain("24.12.2026");
      expect(eve.message).toContain("nach 14 Uhr");

      // Control: the same holiday shift of an adult reports nothing.
      await app.prisma.notification.deleteMany({ where: { userId: plannerId } });
      await setBirthDate(app, seed.mappedEmployeeId, "2000-01-01");
      await runSync(
        app,
        seed,
        [{ date: "2026-10-03", start: "10:00", end: "14:00" }],
        holidayWindow,
      );
      expect(await findingsOf(app, plannerId)).toHaveLength(0);
    } finally {
      await cleanupPhorestTenant(app, seed.tenantId);
    }
  });

  it("birthday weeks: 18th birthday on Friday still reports Thursday, on Wednesday it does not", async () => {
    const seed = await seedPhorestTenant(app, "jas-birthday");
    try {
      const plannerId = await createPlanner(app, seed, "mgr");

      await setBirthDate(app, seed.mappedEmployeeId, "2008-07-31");
      await runSync(app, seed, [THURSDAY_LONG]);
      expect(await findingsOf(app, plannerId)).toHaveLength(1);

      await app.prisma.notification.deleteMany({ where: { userId: plannerId } });
      await setBirthDate(app, seed.mappedEmployeeId, "2008-07-29");
      await runSync(app, seed, [THURSDAY_LONG]);
      expect(await findingsOf(app, plannerId)).toHaveLength(0);
    } finally {
      await cleanupPhorestTenant(app, seed.tenantId);
    }
  });

  it("Reichweite: tenant manager and the salon's planner are told, others and the person are not", async () => {
    const seed = await seedPhorestTenant(app, "jas-reach");
    try {
      await setBirthDate(app, seed.mappedEmployeeId, "2010-03-01");
      const other = await addCoupledSalon(app, seed.tenantId, "branch-2");
      const managerId = await createPlanner(app, seed, "mgr");
      const employeeRoleId = await createPlanner(app, seed, "emp", "EMPLOYEE");
      const otherSalonPlannerId = await createSalonsPlanner(app, seed, "other", [other.salonId]);
      const ownSalonPlannerId = await createSalonsPlanner(app, seed, "own", [seed.salonId]);
      const erika = await app.prisma.employee.findUniqueOrThrow({
        where: { id: seed.mappedEmployeeId },
        select: { userId: true },
      });

      await runSync(app, seed, [THURSDAY_LONG]);

      expect(await findingsOf(app, managerId)).toHaveLength(1);
      expect(await findingsOf(app, ownSalonPlannerId)).toHaveLength(1);
      expect(await findingsOf(app, otherSalonPlannerId)).toHaveLength(0);
      expect(await findingsOf(app, employeeRoleId)).toHaveLength(0);
      expect(await findingsOf(app, erika.userId)).toHaveLength(0);
    } finally {
      await cleanupPhorestTenant(app, seed.tenantId);
    }
  });

  it("a changed finding is reported anew, an unchanged one is not repeated", async () => {
    const seed = await seedPhorestTenant(app, "jas-changed");
    try {
      await setBirthDate(app, seed.mappedEmployeeId, "2010-03-01");
      const plannerId = await createPlanner(app, seed, "mgr");

      await runSync(app, seed, [THURSDAY_LONG]);
      expect(await findingsOf(app, plannerId)).toHaveLength(1);

      const longer: Slot = { date: "2026-07-30", start: "08:00", end: "18:30" };
      await runSync(app, seed, [longer]);
      const rows = await findingsOf(app, plannerId);
      expect(rows).toHaveLength(2);
      expect(rows[1].message).toContain("9:30 Stunden");

      await runSync(app, seed, [longer]);
      expect(await findingsOf(app, plannerId)).toHaveLength(2);
    } finally {
      await cleanupPhorestTenant(app, seed.tenantId);
    }
  });

  it("a failing notification leaves the run SUCCESS and the shifts stored", async () => {
    const seed = await seedPhorestTenant(app, "jas-failure");
    try {
      await setBirthDate(app, seed.mappedEmployeeId, "2010-03-01");
      await createPlanner(app, seed, "mgr");
      vi.spyOn(app, "notify").mockRejectedValue(new Error("notify down"));

      const res = await runSync(app, seed, [THURSDAY_LONG]);
      expect(res.status).toBe("SUCCESS");
      expect(res.created).toBe(1);

      const runs = await app.prisma.phorestSyncRun.findMany({ where: { tenantId: seed.tenantId } });
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("SUCCESS");
      const shifts = await app.prisma.shift.findMany({
        where: { employeeId: seed.mappedEmployeeId, deletedAt: null },
      });
      expect(shifts).toHaveLength(1);
      expect(shifts[0].endTime).toBe("18:00");
    } finally {
      await cleanupPhorestTenant(app, seed.tenantId);
    }
  });

  // ── Issue #1076: §§ 13, 14, 17 (and 15) through the same report call ──────────────────────────

  const THURSDAY_EVENING: Slot = { date: "2026-07-30", start: "12:00", end: "20:30" };
  const SUNDAY_SLOT: Slot = { date: "2026-08-02", start: "10:00", end: "14:00" };

  it("Issue #1076 — a 16-year-old's evening shift and Sunday shift arrive in one notification", async () => {
    const seed = await seedPhorestTenant(app, "jas-1076-night");
    try {
      await setBirthDate(app, seed.mappedEmployeeId, "2010-03-01");
      const plannerId = await createPlanner(app, seed, "mgr");

      const res = await runSync(app, seed, [THURSDAY_EVENING, SUNDAY_SLOT]);
      expect(res.status).toBe("SUCCESS");
      expect(res.created).toBe(2);

      const shifts = await app.prisma.shift.findMany({
        where: { employeeId: seed.mappedEmployeeId, deletedAt: null },
        orderBy: [{ date: "asc" }, { id: "asc" }],
      });
      expect(shifts.map((x) => `${x.startTime}-${x.endTime}`)).toEqual([
        "12:00-20:30",
        "10:00-14:00",
      ]);

      const n = await soleNotification(app.prisma, { where: { userId: plannerId, type: TYPE } });
      expect(n.message.indexOf("Die geplante Arbeitszeit am 30.7.2026")).toBe(0);
      expect(n.message).toContain("§ 14");
      expect(n.message).toContain("Weitere Verstöße in dieser Woche: 2.8.2026 (Sonntagsruhe)");
      for (const forbidden of [
        "2010-03-01",
        "01.03.2010",
        "1.3.2010",
        "birthDate",
        "Geburt",
        "Jahre",
      ]) {
        expect(`${n.title} ${n.message}`).not.toContain(forbidden);
      }
    } finally {
      await cleanupPhorestTenant(app, seed.tenantId);
    }
  });

  it("Issue #1076 — a 17-year-old is reported for § 14, the 18th birthday on the day is not", async () => {
    const seed = await seedPhorestTenant(app, "jas-1076-ages");
    try {
      const plannerId = await createPlanner(app, seed, "mgr");

      await setBirthDate(app, seed.mappedEmployeeId, "2009-03-01");
      await runSync(app, seed, [THURSDAY_EVENING]);
      const n = await soleNotification(app.prisma, { where: { userId: plannerId, type: TYPE } });
      expect(n.message).toContain("§ 14");

      await app.prisma.notification.deleteMany({ where: { userId: plannerId } });
      await setBirthDate(app, seed.mappedEmployeeId, "2008-07-30");
      await runSync(app, seed, [THURSDAY_EVENING]);
      expect(await findingsOf(app, plannerId)).toHaveLength(0);
    } finally {
      await cleanupPhorestTenant(app, seed.tenantId);
    }
  });
});
