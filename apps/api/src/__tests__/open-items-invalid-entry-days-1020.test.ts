/**
 * open-items-invalid-entry-days-1020.test.ts — GitHub issue #1020.
 *
 * `GET /api/v1/dashboard/open-items` answers an additive `invalidEntryDays` list built from the
 * SAME `getInvalidEntries` rows that feed the `invalidEntries` count, so Mein Tag can name WHICH
 * days carry an invalid or still-open own entry. This file proves:
 *   - count parity: `invalidEntryDays.length === invalidEntries` for every caller,
 *   - own-only: another person's invalid entry, a soft-deleted one and a valid one never appear,
 *   - the day is the entry's own calendar day (`@db.Date` read as its UTC date part),
 *   - `open` is true exactly when the entry has no endTime,
 *   - the order is oldest day first.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp, seedTestData, cleanupTestData } from "./setup";
import { pastDateStr, utcMidnight } from "./test-dates";

interface OpenItemsBody {
  invalidEntries: number;
  invalidEntryDays: { date: string; entryId: string; open: boolean }[];
  total: number;
}

describe("GET /api/v1/dashboard/open-items — invalidEntryDays (issue #1020)", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let closedInvalidId: string;
  let openInvalidId: string;

  const DAY_CLOSED = pastDateStr(5);
  const DAY_DELETED = pastDateStr(4);
  const DAY_OPEN = pastDateStr(3);
  const DAY_VALID = pastDateStr(6);

  async function createEntry(opts: {
    employeeId: string;
    day: string;
    closed: boolean;
    invalid: boolean;
    deleted?: boolean;
  }) {
    return app.prisma.timeEntry.create({
      data: {
        employeeId: opts.employeeId,
        salonId: data.salonId,
        date: utcMidnight(opts.day),
        type: "WORK",
        startTime: new Date(`${opts.day}T07:00:00Z`),
        endTime: opts.closed ? new Date(`${opts.day}T15:00:00Z`) : null,
        isInvalid: opts.invalid,
        invalidReasonCode: opts.invalid ? "MISSING_CLOCK_OUT" : null,
        invalidReason: opts.invalid ? "Ausstempeln fehlt" : null,
        deletedAt: opts.deleted ? new Date() : null,
      },
    });
  }

  async function getOpenItems(token: string): Promise<OpenItemsBody> {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/open-items",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as OpenItemsBody;
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "oi-1020");

    const closed = await createEntry({
      employeeId: data.employee.id,
      day: DAY_CLOSED,
      closed: true,
      invalid: true,
    });
    closedInvalidId = closed.id;
    await createEntry({
      employeeId: data.employee.id,
      day: DAY_DELETED,
      closed: true,
      invalid: true,
      deleted: true,
    });
    const open = await createEntry({
      employeeId: data.employee.id,
      day: DAY_OPEN,
      closed: false,
      invalid: true,
    });
    openInvalidId = open.id;
    await createEntry({
      employeeId: data.employee.id,
      day: DAY_VALID,
      closed: true,
      invalid: false,
    });
    // Another person of the same tenant: must never appear in the employee's answer.
    await createEntry({
      employeeId: data.adminEmployee.id,
      day: DAY_CLOSED,
      closed: true,
      invalid: true,
    });
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("Test cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("names the day, id and open flag of each own invalid entry, oldest day first", async () => {
    const body = await getOpenItems(data.empToken);

    expect(body.invalidEntries).toBe(2);
    expect(body.invalidEntryDays).toEqual([
      { date: DAY_CLOSED, entryId: closedInvalidId, open: false },
      { date: DAY_OPEN, entryId: openInvalidId, open: true },
    ]);
  });

  it("keeps the list in step with the count for every caller (own-only)", async () => {
    const emp = await getOpenItems(data.empToken);
    expect(emp.invalidEntryDays.length).toBe(emp.invalidEntries);

    // The admin owns exactly one invalid entry — the employee's entries never leak into it.
    const admin = await getOpenItems(data.adminToken);
    expect(admin.invalidEntries).toBe(1);
    expect(admin.invalidEntryDays.length).toBe(admin.invalidEntries);
    expect(admin.invalidEntryDays[0].date).toBe(DAY_CLOSED);
    expect(admin.invalidEntryDays.map((d) => d.entryId)).not.toContain(closedInvalidId);
    expect(admin.invalidEntryDays.map((d) => d.entryId)).not.toContain(openInvalidId);
  });

  it("leaves the total contract untouched (it keeps counting entries)", async () => {
    const body = await getOpenItems(data.empToken);
    expect(body.total).toBeGreaterThanOrEqual(body.invalidEntries);
  });
});
