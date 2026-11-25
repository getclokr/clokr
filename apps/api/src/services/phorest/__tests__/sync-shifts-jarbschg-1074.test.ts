// Issue #1074 — the Phorest shift sync reports § 8 / § 12 JArbSchG findings for minors.
// Phorest leads: the shift is stored unchanged, the planners (by reach) are notified, never the
// birth date. Run via `pnpm --filter @clokr/api exec vitest run <file>` after `test:setup`.

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { getTestApp, grantSystemRole, soleNotification } from "../../../__tests__/setup";
import { syncPhorestShifts } from "../sync-shifts";
import {
  seedPhorestTenant,
  cleanupPhorestTenant,
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

async function runSync(app: FastifyInstance, seed: PhorestSeed, slots: Slot[]) {
  mockPhorestBody(worktimetables(slots));
  return syncPhorestShifts(app, seed.tenantId, seed.target, WEEK_WINDOW);
}

async function createPlanner(
  app: FastifyInstance,
  seed: PhorestSeed,
  label: string,
  role: "MANAGER" | "EMPLOYEE" = "MANAGER",
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
  await grantSystemRole(app.prisma, { tenantId: seed.tenantId, userId: user.id, role });
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
      expect(n.message).toContain("30.07.2026");
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
      });
      expect(rows.some((r) => r.userId === plannerId && r.type === TYPE)).toBe(true);
      for (const r of rows) {
        const text = `${r.title} ${r.message} ${r.link ?? ""}`;
        for (const forbidden of ["2010-03-01", "01.03.2010", "birthDate", "Geburt", "Jahre"]) {
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
});
