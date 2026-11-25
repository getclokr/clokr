/**
 * Issue #1085 — a day OUTSIDE the retro window still has an OPEN own entry (started, never ended).
 *
 * The prod report: the person opened the day as a NEW entry, typed 08:30 - 12:30 and a reason, and
 * the Zeitnachtrag answered the generic overlap 409 „Überschneidung mit bestehendem Eintrag vom
 * 02.07.2026 (08:30 – läuft)“. The entry-first request (`POST /time-entries` + `reason`) creates a
 * NEW pending entry, which the overlap check refuses against the open one. The right path is the
 * correction proposal (`POST /retro-entry-requests`): its approval ends the open entry (#1021).
 *
 * Server side of the fix, proven here:
 *   - the entry-first request on such a day answers 409 `OPEN_ENTRY_USE_CORRECTION` with a text that
 *     names the correction, instead of the generic overlap, and writes nothing;
 *   - the guard is exactly as wide as the overlap rule: an interval that ends before the open entry
 *     starts is still a valid second interval, a closed entry keeps the generic overlap text, and a
 *     pending Zeitnachtrag row is not "the open entry" (a correction cannot target it);
 *   - the named path works: POST /retro-entry-requests on that day, approved by someone else,
 *     closes the open entry with the proposed times.
 *
 * One distinct past weekday per case. Entries are seeded directly with Prisma. No person names.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { fromZonedTime } from "date-fns-tz";
import { getTestApp, cleanupTestData, seedTestData, auditRowsFor } from "./setup";
import { nextWeekdayStr, pastDateStr, TEST_TZ } from "./test-dates";
import { invalidReasonFields } from "../contexts/time-tracking/invalid-reason";
import {
  OPEN_ENTRY_USE_CORRECTION_CODE,
  OPEN_ENTRY_USE_CORRECTION_MESSAGE,
} from "../contexts/time-tracking/retro-open-entry-guard";

function at(dayStr: string, hhmm: string): Date {
  return fromZonedTime(`${dayStr}T${hhmm}:00`, TEST_TZ);
}

describe("Issue #1085 — a Zeitnachtrag on a day with an open entry names the correction path", () => {
  let app: FastifyInstance;
  let seed: Awaited<ReturnType<typeof seedTestData>>;
  let tenantId: string;
  let employeeId: string;

  async function seedEntry(
    day: string,
    from: string,
    to: string | null,
    extra: Record<string, unknown> = {},
  ) {
    return app.prisma.timeEntry.create({
      data: {
        employeeId,
        date: new Date(`${day}T00:00:00Z`),
        startTime: at(day, from),
        endTime: to ? at(day, to) : null,
        breakMinutes: 0,
        source: "MANUAL",
        salonId: seed.salonId,
        ...extra,
      },
    });
  }

  /** The entry-first Zeitnachtrag exactly as the web form files it. */
  const postEntryFirst = (day: string, from: string, to: string | null, reason = "Vergessen") =>
    app.inject({
      method: "POST",
      url: "/api/v1/time-entries",
      headers: { authorization: `Bearer ${seed.empToken}` },
      payload: {
        employeeId,
        date: day,
        startTime: at(day, from).toISOString(),
        ...(to === null ? {} : { endTime: at(day, to).toISOString() }),
        breakMinutes: 0,
        reason,
      },
    });

  const rowsOfDay = (day: string) =>
    app.prisma.timeEntry.findMany({
      where: { employeeId, date: new Date(`${day}T00:00:00Z`) },
      orderBy: { startTime: "asc" },
    });
  const requestsOfDay = (day: string) =>
    app.prisma.retroEntryRequest.findMany({
      where: { employeeId, targetDate: new Date(`${day}T00:00:00Z`) },
    });

  beforeAll(async () => {
    app = await getTestApp();
    seed = await seedTestData(app, "rop1085");
    tenantId = seed.tenant.id;
    employeeId = seed.employee.id;
  });

  afterAll(async () => {
    try {
      await app.prisma.saldoSnapshot.deleteMany({ where: { employee: { tenantId } } });
      await app.prisma.timeEntry.deleteMany({ where: { employee: { tenantId } } });
      await app.prisma.retroEntryRequest.deleteMany({ where: { employee: { tenantId } } });
      await cleanupTestData(app, tenantId);
    } catch {
      // best-effort cleanup
    }
  });

  it("tracer (the prod case): 08:30 - 12:30 over the open 08:30 entry answers the correction guard, not the overlap, and writes nothing", async () => {
    const day = nextWeekdayStr(pastDateStr(100));
    const open = await seedEntry(day, "08:30", null);

    const res = await postEntryFirst(day, "08:30", "12:30");

    expect(res.statusCode, res.body).toBe(409);
    const body = JSON.parse(res.body) as { error: string; code?: string };
    expect(body.code).toBe(OPEN_ENTRY_USE_CORRECTION_CODE);
    expect(body.error).toBe(OPEN_ENTRY_USE_CORRECTION_MESSAGE);
    // The text says what to do and is not the generic overlap.
    expect(body.error).not.toMatch(/Überschneidung/);
    expect(body.error).toMatch(/Korrektur/);

    // Nothing was written: no second entry, no request, no audit row for either.
    const rows = await rowsOfDay(day);
    expect(rows.map((r) => r.id)).toEqual([open.id]);
    expect(rows[0].endTime).toBeNull();
    expect(await requestsOfDay(day)).toHaveLength(0);
    expect(await auditRowsFor(app, "TimeEntry", open.id)).toHaveLength(0);
  });

  it("an interval without an end on a day with an open entry answers the same guard", async () => {
    const day = nextWeekdayStr(pastDateStr(104));
    await seedEntry(day, "08:30", null);

    const res = await postEntryFirst(day, "09:00", null);

    expect(res.statusCode, res.body).toBe(409);
    expect(JSON.parse(res.body).code).toBe(OPEN_ENTRY_USE_CORRECTION_CODE);
  });

  it("an interval that ends before the open entry starts is still a valid second interval (entry-first stays)", async () => {
    const day = nextWeekdayStr(pastDateStr(108));
    await seedEntry(day, "14:00", null);

    const res = await postEntryFirst(day, "08:00", "12:00");

    expect(res.statusCode, res.body).toBe(201);
    const requests = await requestsOfDay(day);
    expect(requests).toHaveLength(1);
    expect(requests[0].status).toBe("PENDING");
  });

  it("a CLOSED entry on the day keeps the generic overlap text (no correction target)", async () => {
    const day = nextWeekdayStr(pastDateStr(112));
    await seedEntry(day, "08:00", "12:00");

    const res = await postEntryFirst(day, "09:00", "11:00");

    expect(res.statusCode, res.body).toBe(409);
    const body = JSON.parse(res.body) as { error: string; code?: string };
    expect(body.code).toBeUndefined();
    expect(body.error).toMatch(/^Überschneidung mit bestehendem Eintrag/);
  });

  it("a pending Zeitnachtrag row without an end is not 'the open entry': the generic overlap answers", async () => {
    const day = nextWeekdayStr(pastDateStr(116));
    const pending = await app.prisma.retroEntryRequest.create({
      data: {
        employeeId,
        targetDate: new Date(`${day}T00:00:00Z`),
        reason: "Pending fixture",
        startTime: "08:30",
        endTime: null,
        status: "PENDING",
      },
    });
    await seedEntry(day, "08:30", null, {
      isInvalid: true,
      retroRequestId: pending.id,
      ...invalidReasonFields("RETRO_APPROVAL_PENDING"),
    });

    const res = await postEntryFirst(day, "09:00", "10:00");

    expect(res.statusCode, res.body).toBe(409);
    const body = JSON.parse(res.body) as { error: string; code?: string };
    expect(body.code).not.toBe(OPEN_ENTRY_USE_CORRECTION_CODE);
  });

  it("another person's open entry on that day is none of this person's business", async () => {
    const day = nextWeekdayStr(pastDateStr(120));
    // The admin's own open entry on the same day.
    await app.prisma.timeEntry.create({
      data: {
        employeeId: seed.adminEmployee.id,
        date: new Date(`${day}T00:00:00Z`),
        startTime: at(day, "08:30"),
        endTime: null,
        breakMinutes: 0,
        source: "MANUAL",
        salonId: seed.salonId,
      },
    });

    const res = await postEntryFirst(day, "08:30", "12:30");

    expect(res.statusCode, res.body).toBe(201);
  });

  it("the named path works end to end: a correction proposal approved by someone else ends the open entry", async () => {
    const day = nextWeekdayStr(pastDateStr(124));
    const open = await seedEntry(day, "08:30", null);

    const filed = await app.inject({
      method: "POST",
      url: "/api/v1/retro-entry-requests",
      headers: { authorization: `Bearer ${seed.empToken}` },
      payload: {
        targetDate: day,
        reason: "Ausstempeln vergessen",
        startTime: "08:30",
        endTime: "12:30",
      },
    });
    expect(filed.statusCode, filed.body).toBe(201);
    const requestId = (JSON.parse(filed.body) as { id: string }).id;

    // The open entry is untouched until a manager decides.
    expect((await rowsOfDay(day))[0].endTime).toBeNull();

    const approved = await app.inject({
      method: "PATCH",
      url: `/api/v1/retro-entry-requests/${requestId}/review`,
      headers: { authorization: `Bearer ${seed.adminToken}` },
      payload: { status: "APPROVED" },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(JSON.parse(approved.body).status).toBe("USED");

    const rows = await rowsOfDay(day);
    expect(rows.map((r) => r.id)).toEqual([open.id]); // closed in place, never a second entry
    expect(rows[0].startTime.getTime()).toBe(at(day, "08:30").getTime());
    expect(rows[0].endTime?.getTime()).toBe(at(day, "12:30").getTime());
    expect(rows[0].isInvalid).toBe(false);
  });
});
