import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
  createTestSalon,
} from "../../../../__tests__/setup";
import { resolveClockEvent } from "../../../../services/clock/resolver";
import type { ClockEvent } from "../../../../services/clock/types";

// Issue #959 — an entry left open on the previous day. Inside the tenant bound
// (`autoDeleteOpenHours`, 14 h here) it is the running session: the web clock-in answers
// ALREADY_CLOCKED_IN AND the own clock-state read names that entry, so Mein Tag shows it as running
// (before #959 the stage said "not clocked in" while the clock refused). Beyond the bound the entry
// blocks nothing: the clock-state read is empty and clocking in starts a new entry of today, the old
// one stays open for its correction. Web (IN) and NFC (AUTO) follow the same rule.
//
// Tenant time zone Europe/Berlin (CET in November, UTC+1). "Today" is Tue 10.11.2026 local; the
// clock reads 08:00 local = 07:00Z.
const NOW = new Date("2026-11-10T07:00:00.000Z");
const TODAY = new Date("2026-11-10T00:00:00.000Z"); // @db.Date of the local day
const YESTERDAY = new Date("2026-11-09T00:00:00.000Z");

describe("Issue #959 — clock with an open entry of the previous day", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let salonId: string;

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "clock-cross-day-959");
    await app.prisma.tenantConfig.update({
      where: { tenantId: data.tenant.id },
      data: { timezone: "Europe/Berlin", autoDeleteOpenHours: 14 },
    });
    const salon = await app.prisma.salon.findFirstOrThrow({
      where: { tenantId: data.tenant.id, isActive: true },
      orderBy: { createdAt: "asc" },
    });
    salonId = salon.id;
  });

  async function wipeEntries() {
    const entries = await app.prisma.timeEntry.findMany({
      where: { employeeId: data.employee.id },
      select: { id: true },
    });
    const ids = entries.map((e) => e.id);
    await app.prisma.break.deleteMany({ where: { timeEntryId: { in: ids } } });
    await app.prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
    await app.prisma.timeEntry.deleteMany({ where: { employeeId: data.employee.id } });
  }

  afterAll(async () => {
    await wipeEntries();
    await cleanupTestData(app, data.tenant.id);
    await closeTestApp();
  });

  beforeEach(async () => {
    await wipeEntries();
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function jwt() {
    return app.jwt.sign({
      sub: data.empUser.id,
      tenantId: data.tenant.id,
      employeeId: data.employee.id,
    });
  }

  async function openYesterday(startTime: Date) {
    return app.prisma.timeEntry.create({
      data: {
        employeeId: data.employee.id,
        date: YESTERDAY,
        startTime,
        endTime: null,
        breakMinutes: 0,
        source: "MOBILE",
        type: "WORK",
        salonId,
      },
    });
  }

  async function clockState() {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/time-entries/clock-state",
      headers: { authorization: `Bearer ${jwt()}` },
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as {
      crossDay: boolean;
      entry: { id: string; startTime: string; endTime: null; salonId: string } | null;
    };
  }

  async function clockIn() {
    return app.inject({
      method: "POST",
      url: "/api/v1/time-entries/clock-in",
      headers: { authorization: `Bearer ${jwt()}` },
      payload: { source: "MOBILE" },
    });
  }

  function nfcEvent(): ClockEvent {
    return {
      employeeId: data.employee.id,
      tenantId: data.tenant.id,
      source: "NFC",
      intent: "AUTO",
      timestamp: NOW,
      date: TODAY,
      dateStr: "2026-11-10",
      actor: { type: "SYSTEM" },
    };
  }

  it("inside the bound (yesterday 20:00, now 08:00 = 12 h): the clock-state names the running entry and clock-in answers ALREADY_CLOCKED_IN", async () => {
    const open = await openYesterday(new Date("2026-11-09T19:00:00.000Z")); // 20:00 local

    const state = await clockState();
    expect(state.crossDay).toBe(true);
    expect(state.entry?.id).toBe(open.id);
    expect(state.entry?.endTime).toBeNull();

    const res = await clockIn();
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).resolution).toEqual({
      kind: "CONFLICT",
      reason: "ALREADY_CLOCKED_IN",
    });
    // nothing written: still exactly the one open row of yesterday
    const rows = await app.prisma.timeEntry.findMany({
      where: { employeeId: data.employee.id, deletedAt: null },
    });
    expect(rows.map((r) => r.id)).toEqual([open.id]);
  });

  it("inside the bound, Ausstempeln on the shown entry closes it at the punch instant", async () => {
    const open = await openYesterday(new Date("2026-11-09T19:00:00.000Z"));
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/time-entries/${open.id}/clock-out`,
      headers: { authorization: `Bearer ${jwt()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const closed = await app.prisma.timeEntry.findUniqueOrThrow({ where: { id: open.id } });
    expect(closed.endTime?.toISOString()).toBe(NOW.toISOString());
    expect(await clockState()).toEqual({ entry: null, crossDay: false });
  });

  it("exactly at the bound (yesterday 18:00, now 08:00 = 14 h) the entry is still the running session", async () => {
    const open = await openYesterday(new Date("2026-11-09T17:00:00.000Z"));
    expect((await clockState()).entry?.id).toBe(open.id);
    expect((await clockIn()).statusCode).toBe(409);
  });

  it("beyond the bound (14 h + 1 s): the old entry blocks nothing — clock-state empty, clock-in starts a new entry of today", async () => {
    const open = await openYesterday(new Date("2026-11-09T16:59:59.000Z"));

    expect(await clockState()).toEqual({ entry: null, crossDay: false });

    const res = await clockIn();
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      resolution: { kind: string; entry: { id: string; date: string; startTime: string } };
    };
    expect(body.resolution.kind).toBe("CLOCKED_IN");
    expect(body.resolution.entry.id).not.toBe(open.id);
    expect(body.resolution.entry.date.slice(0, 10)).toBe("2026-11-10");
    expect(body.resolution.entry.startTime).toBe(NOW.toISOString());
    // the forgotten entry stays open, its end is never fabricated (§ 16 Abs. 2 ArbZG)
    const old = await app.prisma.timeEntry.findUniqueOrThrow({ where: { id: open.id } });
    expect(old.endTime).toBeNull();
    // and the new one is the clock's state now
    const state = await clockState();
    expect(state.crossDay).toBe(false);
    expect(state.entry?.id).toBe(body.resolution.entry.id);
  });

  it("over midnight (23:30 → 00:30): the clock-state names the session across midnight", async () => {
    vi.setSystemTime(new Date("2026-11-09T23:30:00.000Z")); // 00:30 local on 10.11.
    const open = await openYesterday(new Date("2026-11-09T22:30:00.000Z")); // 23:30 local on 9.11.
    const state = await clockState();
    expect(state.crossDay).toBe(true);
    expect(state.entry?.id).toBe(open.id);
  });

  it("NFC follows the same rule: inside the bound a tap stops the entry, beyond it a tap starts a new one", async () => {
    const inside = await openYesterday(new Date("2026-11-09T19:00:00.000Z"));
    const stop = await resolveClockEvent(app, nfcEvent());
    expect(stop.kind).toBe("CLOCKED_OUT");
    expect(stop.kind === "CLOCKED_OUT" && stop.entry.id).toBe(inside.id);

    await wipeEntries();
    const beyond = await openYesterday(new Date("2026-11-09T16:59:59.000Z"));
    const start = await resolveClockEvent(app, nfcEvent());
    expect(start.kind).toBe("CLOCKED_IN");
    expect(start.kind === "CLOCKED_IN" && start.entry.id).not.toBe(beyond.id);
    const old = await app.prisma.timeEntry.findUniqueOrThrow({ where: { id: beyond.id } });
    expect(old.endTime).toBeNull();
  });

  it("the clock-salon answer treats the session across midnight as running (multi-salon: no choice, its salon fixed)", async () => {
    vi.useRealTimers();
    const second = await createTestSalon(app.prisma, data.tenant.id, { name: "Zweiter Salon 959" });
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    try {
      const get = async () => {
        const res = await app.inject({
          method: "GET",
          url: "/api/v1/time-entries/clock-salon",
          headers: { authorization: `Bearer ${jwt()}` },
        });
        expect(res.statusCode).toBe(200);
        return JSON.parse(res.body) as {
          offerChoice: boolean;
          fixedSalon: { id: string } | null;
        };
      };
      // control: an empty day of a multi-salon tenant offers the choice
      expect((await get()).offerChoice).toBe(true);
      await openYesterday(new Date("2026-11-09T19:00:00.000Z"));
      const running = await get();
      expect(running.offerChoice).toBe(false);
      expect(running.fixedSalon?.id).toBe(salonId);
    } finally {
      await app.prisma.salon.delete({ where: { id: second.id } });
    }
  });
});
