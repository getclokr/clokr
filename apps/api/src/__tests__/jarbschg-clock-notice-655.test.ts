/**
 * Issue #655 — the JArbSchG notice after every clock STOP (web, NFC terminal, WLAN).
 *
 * Clocking is never refused or delayed for a JArbSchG finding (D-08). After the STOP the one
 * post-STOP step (`runClockStopSteps`, #799) evaluates the whole day of a person under 18 with the
 * kernels of the manual paths — § 8 through `checkArbZG`, § 9 through `checkJArbSchG` over the day
 * total — and tells the responsible persons (D-09, D-10): holders of `time-entry:update:ZUGEWIESEN`
 * with at least one entry of the day in reach, never the person, the full text only where the reach
 * covers the whole ISO week, one row per recipient, person and day ever.
 *
 * Fake Date like clock-second-salon-70; fixture days are past weekdays; no person names.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import crypto, { randomBytes, createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { fromZonedTime } from "date-fns-tz";
import { getTestApp, seedTestData, cleanupTestData, createTestSalon } from "./setup";
import { TEST_TZ } from "./test-dates";
import { normalizeRolePermissions, roleNameKey } from "../contexts/platform";
import { checkArbZG } from "../contexts/time-tracking/arbzg";
import {
  MINOR_DAY_NOTICE_TITLE,
  SECTION9_DAY_NOTICE_TEXT,
  minorDayFindingMessages,
} from "../contexts/time-tracking/minor-day-notice";

const TYPE = "JARBSCHG_DAY_VIOLATION";
const BIRTH_AGE_16 = new Date("2010-03-15T00:00:00.000Z");
const NFC_CARD_ID = `NFC-655-${randomUUID()}`;
const MAC_RAW = "AA:BB:CC:DD:EE:01";
const MAC_NORMALIZED = "aa:bb:cc:dd:ee:01";
const PRESENCE_KEY = `clk_pwh_655_${Date.now().toString(36)}`;
const MANAGER_PERMISSIONS = ["time-entry:update:ZUGEWIESEN", "time-entry:read:ZUGEWIESEN"];

// One distinct, holiday-free past Monday..Friday per case (August/September 2026).
const DAY = {
  c1: "2026-08-17",
  c2: "2026-08-18",
  c3: "2026-08-19",
  c4: "2026-08-20",
  c5: "2026-08-21",
  c6: "2026-08-24",
  c7adult: "2026-08-25",
  c7none: "2026-08-26",
  c7dismissed: "2026-08-27",
  c8: "2026-08-28",
} as const;

const instant = (day: string, hhmm: string): Date => fromZonedTime(`${day}T${hhmm}:00`, TEST_TZ);

/** "2026-08-18" -> "18.08.2026". */
function germanDay(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}.${m}.${y}`;
}

type Warning = { code: string; message: string };

describe("Issue #655 — notice about a minor's JArbSchG finding after a clock STOP", () => {
  let app: FastifyInstance;
  let seed: Awaited<ReturnType<typeof seedTestData>>;
  let salonA: { id: string };
  let salonB: { id: string };
  let salonC: { id: string };
  let mgrA: { userId: string };
  let mgrC: { userId: string };
  let terminalApiKey: string;
  let seq = 0;

  const employeeName = () => "Fixture Minor";

  async function withClock<T>(day: string, hhmm: string, fn: () => Promise<T>): Promise<T> {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(instant(day, hhmm));
    try {
      return await fn();
    } finally {
      vi.useRealTimers();
    }
  }

  const clockIn = (day: string, hhmm: string, payload: Record<string, unknown> = {}) =>
    withClock(day, hhmm, () =>
      app.inject({
        method: "POST",
        url: "/api/v1/time-entries/clock-in",
        headers: { authorization: `Bearer ${seed.empToken}` },
        payload: { source: "MOBILE", salonId: salonA.id, ...payload },
      }),
    );

  const clockOut = (day: string, hhmm: string, entryId: string) =>
    withClock(day, hhmm, () =>
      app.inject({
        method: "POST",
        url: `/api/v1/time-entries/${entryId}/clock-out`,
        headers: { authorization: `Bearer ${seed.empToken}` },
        payload: {},
      }),
    );

  const nfcPunch = (day: string, hhmm: string) =>
    withClock(day, hhmm, () =>
      app.inject({
        method: "POST",
        url: "/api/v1/time-entries/nfc-punch",
        headers: { authorization: `Bearer ${terminalApiKey}` },
        payload: { nfcCardId: NFC_CARD_ID },
      }),
    );

  /** A web clock-in at `from` and clock-out at `to`; returns the clock-out response and entry id. */
  async function webDay(day: string, from: string, to: string, salonId = salonA.id) {
    const inRes = await clockIn(day, from, { salonId });
    expect(inRes.statusCode, inRes.body).toBe(200);
    const entryId = JSON.parse(inRes.body).resolution.entry.id as string;
    const outRes = await clockOut(day, to, entryId);
    expect(outRes.statusCode, outRes.body).toBe(200);
    return { entryId, outRes };
  }

  const warningsOf = (res: { body: string }): Warning[] => JSON.parse(res.body).warnings ?? [];

  const noticesFor = (userId: string, day: string) =>
    app.prisma.notification.findMany({
      where: {
        userId,
        type: TYPE,
        relatedType: "EmployeeDay",
        relatedId: `${seed.employee.id}:${day}`,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

  const allNoticesOfType = () =>
    app.prisma.notification.findMany({
      where: { type: TYPE, user: { employee: { tenantId: seed.tenant.id } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

  const setPerson = (birthDate: Date | null, classification: "VOLLZEIT" | "AZUBI" = "VOLLZEIT") =>
    app.prisma.employee.update({
      where: { id: seed.employee.id },
      data: { birthDate, classification },
    });

  const setAutoBreak = (enabled: boolean) =>
    app.prisma.tenantConfig.update({
      where: { tenantId: seed.tenant.id },
      data: { autoBreakEnabled: enabled },
    });

  /** A manager holding the update/read ZUGEWIESEN permissions over exactly `salonIds`. */
  async function createScopedManager(label: string, salonIds: string[]) {
    const s = `${label}-${++seq}-${Date.now().toString(36)}`;
    const user = await app.prisma.user.create({
      data: {
        email: `jn655-${s}@test.de`,
        passwordHash: await bcrypt.hash("test1234", 4),
        isActive: true,
      },
    });
    await app.prisma.employee.create({
      data: {
        tenantId: seed.tenant.id,
        userId: user.id,
        employeeNumber: `JN655-${s}`.slice(0, 30),
        firstName: "Fixture",
        lastName: label,
        hireDate: new Date("2024-01-01T00:00:00Z"),
      },
    });
    const name = `JN655 ${crypto.randomBytes(3).toString("hex")}`;
    const role = await app.prisma.accessRole.create({
      data: {
        tenantId: seed.tenant.id,
        name,
        nameKey: roleNameKey(name),
        permissions: normalizeRolePermissions(MANAGER_PERMISSIONS),
      },
    });
    await app.prisma.roleAssignment.create({
      data: {
        tenantId: seed.tenant.id,
        userId: user.id,
        accessRoleId: role.id,
        scopeType: "SALONS",
        salonIds,
        employeeIds: [],
      },
    });
    return { userId: user.id };
  }

  beforeAll(async () => {
    app = await getTestApp();
    seed = await seedTestData(app, "jn655");
    await app.prisma.employee.update({
      where: { id: seed.employee.id },
      data: { firstName: "Fixture", lastName: "Minor", nfcCardId: NFC_CARD_ID },
    });
    salonA = await createTestSalon(app.prisma, seed.tenant.id, { name: "Salon A" });
    salonB = await createTestSalon(app.prisma, seed.tenant.id, { name: "Salon B" });
    salonC = await createTestSalon(app.prisma, seed.tenant.id, { name: "Salon C" });
    mgrA = await createScopedManager("mgr-a", [salonA.id]);
    mgrC = await createScopedManager("mgr-c", [salonC.id]);

    terminalApiKey = `clk_${randomBytes(32).toString("hex")}`;
    await app.prisma.terminalApiKey.create({
      data: {
        tenantId: seed.tenant.id,
        name: "Test Terminal",
        keyHash: createHash("sha256").update(terminalApiKey).digest("hex"),
        keyPrefix: terminalApiKey.substring(0, 12) + "...",
      },
    });
    await app.prisma.presenceSource.create({
      data: {
        tenantId: seed.tenant.id,
        name: "Test FritzBox",
        keyHash: createHash("sha256").update(PRESENCE_KEY).digest("hex"),
        keyPrefix: PRESENCE_KEY.slice(0, 8),
        revokedAt: null,
      },
    });
    await app.prisma.tenantConfig.update({
      where: { tenantId: seed.tenant.id },
      data: { autoBreakEnabled: false, timezone: TEST_TZ, wifiPresenceWindowMinutes: 15 },
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await app.prisma.notification.deleteMany({ where: { type: TYPE } });
    await app.prisma.absence.deleteMany({ where: { employeeId: seed.employee.id } });
    await app.prisma.shift.deleteMany({ where: { employeeId: seed.employee.id } });
    await app.prisma.timeEntry.deleteMany({ where: { employeeId: seed.employee.id } });
    await setAutoBreak(false);
    await setPerson(BIRTH_AGE_16);
  });

  afterAll(async () => {
    try {
      await app.prisma.terminalApiKey.deleteMany({ where: { tenantId: seed.tenant.id } });
      await app.prisma.presenceSource.deleteMany({ where: { tenantId: seed.tenant.id } });
      await cleanupTestData(app, seed.tenant.id);
    } catch (err) {
      console.error("Test cleanup failed:", err);
    }
  });

  it("C1 Berufsschultag: 13:00-17:00 on a minor's school day -> 200, closed entry, one § 9 notice to the admin", async () => {
    await setPerson(BIRTH_AGE_16, "AZUBI");
    await app.prisma.absence.create({
      data: {
        employeeId: seed.employee.id,
        type: "VOCATIONAL_SCHOOL",
        source: "PATTERN",
        startDate: new Date(`${DAY.c1}T00:00:00.000Z`),
        endDate: new Date(`${DAY.c1}T00:00:00.000Z`),
        days: 1.0,
        createdBy: "jarbschg-clock-notice-655-test",
      },
    });
    const { entryId } = await webDay(DAY.c1, "13:00", "17:00");
    const closed = await app.prisma.timeEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(closed.endTime).not.toBeNull();

    const adminNotices = await noticesFor(seed.adminUser.id, DAY.c1);
    expect(adminNotices).toHaveLength(1);
    expect(adminNotices[0].message).toContain(SECTION9_DAY_NOTICE_TEXT);
    expect(adminNotices[0].title).toBe(MINOR_DAY_NOTICE_TITLE);
    expect(adminNotices[0].message).not.toContain("kürzen");
    expect(await noticesFor(seed.empUser.id, DAY.c1)).toHaveLength(0);
  });

  it("C2 daily max: 07:00-17:00 -> 200, § 8 notice with the figure and the day link, the response carries the finding", async () => {
    const { outRes } = await webDay(DAY.c2, "07:00", "17:00");
    expect(warningsOf(outRes).map((w) => w.code)).toContain("JARBSCHG_DAILY_MAX_EXCEEDED");

    const adminNotices = await noticesFor(seed.adminUser.id, DAY.c2);
    expect(adminNotices).toHaveLength(1);
    const notice = adminNotices[0];
    expect(notice.title).toBe(MINOR_DAY_NOTICE_TITLE);
    expect(notice.message).toContain("§ 8 JArbSchG: Tägliche Höchstarbeitszeit");
    expect(notice.message).toContain("Erfasst: 10:00 Std.");
    expect(notice.message).toContain(`${employeeName()}: Am ${germanDay(DAY.c2)}`);
    expect(notice.message).not.toContain("kürzen");
    expect(notice.link).toBe(`/team/time-entries?employeeId=${seed.employee.id}&date=${DAY.c2}`);
    expect(await noticesFor(seed.empUser.id, DAY.c2)).toHaveLength(0);
  });

  it("C3 several entries: no notice after the first clock-out, one per recipient after the second, still one after a third", async () => {
    // 07:00-11:00 in salon A: 4:00 only, no finding.
    await webDay(DAY.c3, "07:00", "11:00", salonA.id);
    expect(await allNoticesOfType()).toHaveLength(0);

    // 11:30-16:30 in salon B: the day is now 9:00, above the § 8 ceiling.
    await webDay(DAY.c3, "11:30", "16:30", salonB.id);
    const adminNotices = await noticesFor(seed.adminUser.id, DAY.c3);
    const mgrANotices = await noticesFor(mgrA.userId, DAY.c3);
    expect(adminNotices).toHaveLength(1);
    expect(adminNotices[0].message).toContain("Erfasst: 9:00 Std.");
    expect(mgrANotices).toHaveLength(1);
    expect(await noticesFor(mgrC.userId, DAY.c3)).toHaveLength(0);

    // The manager of salon A reads only a part of the day: the neutral notice, no figure.
    expect(mgrANotices[0].message).toBe(
      `${employeeName()}, ${germanDay(DAY.c3)}: Für diesen Tag liegt ein Prüfhinweis vor; die Klärung erfolgt über den Stammsalon.`,
    );
    expect(mgrANotices[0].message).not.toContain("§");
    expect(mgrANotices[0].message).not.toContain("Std");

    // A third short pair: still one row per recipient.
    await webDay(DAY.c3, "17:00", "17:30", salonA.id);
    expect(await noticesFor(seed.adminUser.id, DAY.c3)).toHaveLength(1);
    expect(await noticesFor(mgrA.userId, DAY.c3)).toHaveLength(1);
    expect(await noticesFor(mgrC.userId, DAY.c3)).toHaveLength(0);
  });

  it("C4 NFC: the second punch answers 200 OUT and the admin gets one notice", async () => {
    const first = await nfcPunch(DAY.c4, "07:00");
    expect(first.statusCode, first.body).toBe(200);
    const second = await nfcPunch(DAY.c4, "17:00");
    expect(second.statusCode, second.body).toBe(200);
    expect(JSON.parse(second.body).action).toBe("OUT");

    const adminNotices = await noticesFor(seed.adminUser.id, DAY.c4);
    expect(adminNotices).toHaveLength(1);
    expect(adminNotices[0].message).toContain("Erfasst: 10:00 Std.");
  });

  it("C5 WLAN: connected 07:00 and disconnected 17:00 answer 200 and the admin gets one notice", async () => {
    await app.prisma.employee.update({
      where: { id: seed.employee.id },
      data: { wifiMacs: [MAC_NORMALIZED], wifiPresenceEnabled: true },
    });
    await app.prisma.shift.create({
      data: {
        employeeId: seed.employee.id,
        salonId: seed.salonId,
        date: new Date(`${DAY.c5}T00:00:00.000Z`),
        startTime: "07:00",
        endTime: "17:00",
        label: "Testschicht",
      },
    });
    const send = (eventType: string, hhmm: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/presence/events",
        headers: { authorization: `Bearer ${PRESENCE_KEY}` },
        payload: {
          mac: MAC_RAW,
          eventType,
          timestamp: instant(DAY.c5, hhmm).toISOString(),
          adapter: "fritzbox",
        },
      });
    const connected = await send("connected", "07:00");
    expect(connected.statusCode, connected.body).toBe(200);
    const open = await app.prisma.timeEntry.findFirst({
      where: { employeeId: seed.employee.id, deletedAt: null, source: "WIFI" },
    });
    expect(open, "the connect must have opened a WIFI entry").not.toBeNull();
    const disconnected = await send("disconnected", "17:00");
    expect(disconnected.statusCode, disconnected.body).toBe(200);
    expect(JSON.parse(disconnected.body)).toEqual({ ok: true });
    const closed = await app.prisma.timeEntry.findUniqueOrThrow({ where: { id: open!.id } });
    expect(closed.endTime).not.toBeNull();

    const adminNotices = await noticesFor(seed.adminUser.id, DAY.c5);
    expect(adminNotices).toHaveLength(1);
    expect(adminNotices[0].message).toContain("§ 8 JArbSchG");
    await app.prisma.employee.update({
      where: { id: seed.employee.id },
      data: { wifiMacs: [], wifiPresenceEnabled: false },
    });
  });

  it("C6 runs after the automatic break: 07:00-16:30 with a 60-minute automatic break is 8:30 and gives no notice", async () => {
    await setAutoBreak(true);
    const { entryId } = await webDay(DAY.c6, "07:00", "16:30");
    const closed = await app.prisma.timeEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(closed.breakMinutes, "the automatic break must have been written first").toBe(60);
    expect(await allNoticesOfType()).toHaveLength(0);
  });

  describe("C7 controls", () => {
    it("an adult gets no notice for the same day", async () => {
      await setPerson(new Date("1990-03-15T00:00:00.000Z"));
      await webDay(DAY.c7adult, "07:00", "17:00");
      expect(await allNoticesOfType()).toHaveLength(0);
    });

    it("a person without a birth date gets no notice", async () => {
      await setPerson(null);
      await webDay(DAY.c7none, "07:00", "17:00");
      expect(await allNoticesOfType()).toHaveLength(0);
    });

    it("a dismissed notice is not re-created by a later STOP of the same day", async () => {
      await webDay(DAY.c7dismissed, "07:00", "17:00");
      const first = await noticesFor(seed.adminUser.id, DAY.c7dismissed);
      expect(first).toHaveLength(1);
      await app.prisma.notification.update({
        where: { id: first[0].id },
        data: { dismissedAt: new Date() },
      });
      await webDay(DAY.c7dismissed, "17:30", "18:00");
      const after = await noticesFor(seed.adminUser.id, DAY.c7dismissed);
      expect(after).toHaveLength(1);
      expect(after[0].dismissedAt).not.toBeNull();
    });
  });

  it("C8 failure isolation: a failing notify is logged and the clock-out still answers 200 with the entry closed", async () => {
    const errorSpy = vi.spyOn(app.log, "error");
    const notify = app.notify.bind(app);
    vi.spyOn(app, "notify").mockImplementation(async (params) => {
      if (params.type === TYPE) throw new Error("notify down");
      return notify(params);
    });
    const { entryId } = await webDay(DAY.c8, "07:00", "17:00");
    const closed = await app.prisma.timeEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(closed.endTime).not.toBeNull();
    expect(await allNoticesOfType()).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("C9 parity: the notice texts are the JARBSCHG_* messages of checkArbZG, the same kernel as the manual paths", async () => {
    await webDay(DAY.c2, "07:00", "17:00");
    const date = new Date(`${DAY.c2}T00:00:00.000Z`);
    const expected = (await checkArbZG(app.prisma, seed.employee.id, date))
      .filter((w) => w.code.startsWith("JARBSCHG_"))
      .map((w) => w.message);
    expect(expected.length).toBeGreaterThan(0);
    const messages = await minorDayFindingMessages(app.prisma, {
      tenantId: seed.tenant.id,
      employeeId: seed.employee.id,
      date,
    });
    expect(messages).toEqual(expected);
    const adminNotices = await noticesFor(seed.adminUser.id, DAY.c2);
    expect(adminNotices).toHaveLength(1);
    expect(adminNotices[0].message).toContain(expected.join(" "));
  });

  it("C10 source guard: both adapters call the one post-STOP step and no longer the automatic-break half", () => {
    const root = join(__dirname, "..", "contexts", "time-tracking", "api");
    const timeEntries = readFileSync(join(root, "time-entries.ts"), "utf8");
    const presence = readFileSync(join(root, "presence.ts"), "utf8");
    const count = (text: string, needle: string) => text.split(needle).length - 1;
    expect(count(timeEntries, "runClockStopSteps(")).toBe(2);
    expect(count(presence, "runClockStopSteps(")).toBe(1);
    expect(timeEntries).not.toContain("applyAutoBreakAfterClockStop(");
    expect(presence).not.toContain("applyAutoBreakAfterClockStop(");
    // Line pin of lint-tenant-scoping-exceptions.json: the adapter edit is token-only.
    expect(timeEntries.split("\n").length - 1).toBe(3792);
  });
});
