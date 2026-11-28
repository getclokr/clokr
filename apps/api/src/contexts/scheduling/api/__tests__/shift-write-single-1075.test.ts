/**
 * Issue #1075 — the single roster writes (POST, PUT, restore) run the one gate
 * `checkShiftWrite`. The pure rule cases are in `shift-write-checks-1075.test.ts`; the collective
 * paths are in `shift-write-collective-1075.test.ts`.
 *
 * Synthetic names only (CLAUDE.md PII rule).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
  auditRowsFor,
} from "../../../../__tests__/setup";
import { pastDateStr, todayStr } from "../../../../__tests__/test-dates";
import {
  day,
  liveShifts,
  mkPerson,
  shiftCreateAuditCount,
  storedShift,
  type SeedData,
} from "../../../../__tests__/shift-write-fixtures-1075";

describe("single shift writes — one gate (Issue #1075)", () => {
  let app: FastifyInstance;
  let data: SeedData;

  const auth = () => ({ authorization: `Bearer ${data.adminToken}` });
  const person = (label: string, opts: Parameters<typeof mkPerson>[3] = {}) =>
    mkPerson(app, data, label, opts);
  const stored = (emp: string, dateIso: string, start: string, end: string, extra = {}) =>
    storedShift(app, data, emp, dateIso, start, end, extra);

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "write1075single");
    await app.prisma.tenantConfig.update({
      where: { tenantId: data.tenant.id },
      data: { defaultBreakOver6h: 30, defaultBreakOver9h: 45 },
    });
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("shift-write-single-1075 cleanup failed:", err);
    }
    await closeTestApp();
  });

  // ── POST ────────────────────────────────────────────────────────────────────────────────────

  describe("POST /shifts", () => {
    const post = (payload: Record<string, unknown>, query = "") =>
      app.inject({ method: "POST", url: `/api/v1/shifts${query}`, headers: auth(), payload });

    it("a day sum above 10:00 is refused (422, not forceable), force changes nothing, nothing is written", async () => {
      const emp = await person("PostDay");
      await stored(emp, day(1), "08:00", "13:00");
      const auditsBefore = await shiftCreateAuditCount(app);
      const body = { employeeId: emp, date: day(1), startTime: "13:30", endTime: "19:30" };

      const res = await post(body);
      expect(res.statusCode, res.body).toBe(422);
      const json = JSON.parse(res.body);
      expect(json).toMatchObject({
        error: "ArbZG-Verstoß",
        code: "ARBZG_VIOLATION_DAILY_MAX",
        canForce: false,
      });
      expect(json.message).toContain(day(1).split("-").reverse().join("."));

      const forced = await post(body, "?force=true");
      expect(forced.statusCode, forced.body).toBe(422);
      expect(await liveShifts(app, emp)).toHaveLength(1);
      expect(await shiftCreateAuditCount(app)).toBe(auditsBefore);
    });

    it("a day after the exit day is refused (422 SHIFT_NO_CONTRACT, not forceable), the exit day itself is plannable", async () => {
      const emp = await person("PostExit", { exitDate: day(2) });
      const body = { employeeId: emp, date: day(3), startTime: "08:00", endTime: "16:00" };

      const res = await post(body);
      expect(res.statusCode, res.body).toBe(422);
      expect(JSON.parse(res.body)).toMatchObject({
        error: "Schicht-Zuweisung nicht möglich",
        code: "SHIFT_NO_CONTRACT",
        message: "Für diese Person gilt an diesem Tag kein Vertrag.",
      });

      const forced = await post(body, "?force=true");
      expect(forced.statusCode, forced.body).toBe(422);
      expect(JSON.parse(forced.body).code).toBe("SHIFT_NO_CONTRACT");
      expect(await liveShifts(app, emp)).toHaveLength(0);

      const onExitDay = await post({ ...body, date: day(2) });
      expect(onExitDay.statusCode, onExitDay.body).toBe(201);
    });

    it("a short rest to the NEXT day's shift is a forceable 409; forced, it writes the shift and a nextShiftId audit", async () => {
      const emp = await person("PostRest");
      const next = await stored(emp, day(2), "06:00", "14:00");
      const body = { employeeId: emp, date: day(1), startTime: "14:00", endTime: "22:00" };

      const refused = await post(body);
      expect(refused.statusCode, refused.body).toBe(409);
      expect(JSON.parse(refused.body)).toMatchObject({
        code: "ARBZG_VIOLATION_REST_PERIOD",
        canForce: true,
      });
      expect(await liveShifts(app, emp)).toHaveLength(1);

      const forced = await post(body, "?force=true");
      expect(forced.statusCode, forced.body).toBe(201);
      const created = JSON.parse(forced.body);
      const rows = await auditRowsFor(app, "Shift", created.id, "SHIFT_FORCED_OVER_ARBZG");
      expect(rows).toHaveLength(1);
      expect(rows[0].newValue).toMatchObject({
        nextShiftId: next.id,
        restGapHours: 8,
        forcedByUserId: expect.any(String),
      });
      expect(rows[0].newValue).not.toHaveProperty("prevShiftId");
    });

    it("a short rest to the previous day keeps the old message and the prevShiftId audit", async () => {
      const emp = await person("PostPrev");
      const prev = await stored(emp, day(1), "14:00", "23:00");
      const body = { employeeId: emp, date: day(2), startTime: "08:00", endTime: "16:00" };
      const refused = await post(body);
      expect(refused.statusCode, refused.body).toBe(409);
      expect(JSON.parse(refused.body).message).toContain(
        "zwischen Schichtende am " +
          day(1).split("-").reverse().join(".") +
          " und neuem Beginn liegen nur 9.0h",
      );
      const forced = await post(body, "?force=true");
      expect(forced.statusCode, forced.body).toBe(201);
      const rows = await auditRowsFor(
        app,
        "Shift",
        JSON.parse(forced.body).id,
        "SHIFT_FORCED_OVER_ARBZG",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].newValue).toMatchObject({ prevShiftId: prev.id, restGapHours: 9 });
    });

    it("yesterday (tenant day) is immutable, today is plannable", async () => {
      const emp = await person("PostPast");
      const past = await post({
        employeeId: emp,
        date: pastDateStr(1),
        startTime: "08:00",
        endTime: "16:00",
      });
      expect(past.statusCode, past.body).toBe(422);
      expect(JSON.parse(past.body)).toMatchObject({
        error: "Schicht-Anlage in der Vergangenheit nicht erlaubt",
        code: "SHIFT_PAST_IMMUTABLE",
      });
      expect(await liveShifts(app, emp)).toHaveLength(0);

      // force also covers a closed Sunday should today be one
      const today = await post(
        { employeeId: emp, date: todayStr(), startTime: "08:00", endTime: "16:00" },
        "?force=true",
      );
      expect(today.statusCode, today.body).toBe(201);
    });

    it("a person without a contract on the day gets the contract answer", async () => {
      const emp = await person("PostNoContract", { noContract: true });
      const res = await post({
        employeeId: emp,
        date: day(1),
        startTime: "08:00",
        endTime: "16:00",
      });
      expect(res.statusCode, res.body).toBe(422);
      expect(JSON.parse(res.body)).toMatchObject({
        error: "Schicht-Zuweisung nicht möglich",
        code: "SHIFT_NO_CONTRACT",
      });
    });

    it("a closed Sunday is a forceable 409; forced, it writes the SHIFT_FORCED_OUTSIDE_HOURS audit", async () => {
      const emp = await person("PostSunday");
      const body = { employeeId: emp, date: day(6), startTime: "08:00", endTime: "16:00" };
      const refused = await post(body);
      expect(refused.statusCode, refused.body).toBe(409);
      expect(JSON.parse(refused.body)).toMatchObject({
        code: "SHIFT_OUTSIDE_STORE_HOURS",
        canForce: true,
      });
      const forced = await post(body, "?force=true");
      expect(forced.statusCode, forced.body).toBe(201);
      const rows = await auditRowsFor(
        app,
        "Shift",
        JSON.parse(forced.body).id,
        "SHIFT_FORCED_OUTSIDE_HOURS",
      );
      expect(rows).toHaveLength(1);
    });

    it("a single 08:00-18:30 shift is accepted", async () => {
      const emp = await person("PostPlain");
      const res = await post({
        employeeId: emp,
        date: day(3),
        startTime: "08:00",
        endTime: "18:30",
      });
      expect(res.statusCode, res.body).toBe(201);
    });
  });

  // ── PUT ─────────────────────────────────────────────────────────────────────────────────────

  describe("PUT /shifts/:id", () => {
    const put = (id: string, payload: Record<string, unknown>, query = "") =>
      app.inject({ method: "PUT", url: `/api/v1/shifts/${id}${query}`, headers: auth(), payload });

    it("a label-only edit of an already illegal legacy shift passes, a lengthening is refused with the row untouched", async () => {
      const emp = await person("PutLegacy");
      const legacy = await stored(emp, day(1), "07:00", "18:30"); // 11:30 gross, 10:45 net
      expect((await put(legacy.id, { label: "Neues Etikett" })).statusCode).toBe(200);
      expect((await put(legacy.id, { endTime: "18:00" })).statusCode).toBe(200); // shorter

      const worse = await put(legacy.id, { endTime: "19:00" }, "?force=true");
      expect(worse.statusCode, worse.body).toBe(422);
      expect(JSON.parse(worse.body)).toMatchObject({
        code: "ARBZG_VIOLATION_DAILY_MAX",
        canForce: false,
      });
      const row = await app.prisma.shift.findUniqueOrThrow({ where: { id: legacy.id } });
      expect(row.endTime).toBe("18:00");
      expect(await auditRowsFor(app, "Shift", legacy.id, "UPDATE")).toHaveLength(2);
    });

    it("moving a shift onto a day that already holds another one counts the day together", async () => {
      const emp = await person("PutMove");
      const moving = await stored(emp, day(1), "08:00", "13:00");
      await stored(emp, day(2), "13:30", "19:30");
      const res = await put(moving.id, { date: day(2) });
      expect(res.statusCode, res.body).toBe(422);
      expect(JSON.parse(res.body).code).toBe("ARBZG_VIOLATION_DAILY_MAX");
      const row = await app.prisma.shift.findUniqueOrThrow({ where: { id: moving.id } });
      expect(row.date.toISOString().slice(0, 10)).toBe(day(1));
    });

    it("a lengthening that shortens the rest to the NEXT day is a forceable 409 and the forced audit carries nextShiftId", async () => {
      const emp = await person("PutRest");
      const mine = await stored(emp, day(1), "14:00", "20:00");
      const next = await stored(emp, day(2), "06:00", "14:00");
      const refused = await put(mine.id, { endTime: "22:00" });
      expect(refused.statusCode, refused.body).toBe(409);
      expect(JSON.parse(refused.body)).toMatchObject({
        code: "ARBZG_VIOLATION_REST_PERIOD",
        canForce: true,
      });
      const forced = await put(mine.id, { endTime: "22:00" }, "?force=true");
      expect(forced.statusCode, forced.body).toBe(200);
      const rows = await auditRowsFor(app, "Shift", mine.id, "SHIFT_FORCED_OVER_ARBZG");
      expect(rows).toHaveLength(1);
      expect(rows[0].newValue).toMatchObject({ nextShiftId: next.id, restGapHours: 8 });
    });

    it("a day before the tenant's today cannot be changed, the answer keeps its title", async () => {
      const emp = await person("PutPast");
      const past = await stored(emp, pastDateStr(1), "08:00", "16:00");
      const res = await put(past.id, { label: "x" });
      expect(res.statusCode, res.body).toBe(422);
      expect(JSON.parse(res.body)).toMatchObject({
        error: "Schicht-Änderung in der Vergangenheit nicht erlaubt",
        code: "SHIFT_PAST_IMMUTABLE",
      });
    });

    it("an employeeId of another tenant answers 404 before any rule and leaves the row alone (GD-9)", async () => {
      const emp = await person("PutForeign");
      const mine = await stored(emp, day(1), "08:00", "16:00");
      const other = await seedTestData(app, "write1075other");
      try {
        const res = await put(mine.id, { employeeId: other.employee.id });
        expect(res.statusCode, res.body).toBe(404);
        expect(JSON.parse(res.body)).toEqual({ error: "Mitarbeiter nicht gefunden" });
        const row = await app.prisma.shift.findUniqueOrThrow({ where: { id: mine.id } });
        expect(row.employeeId).toBe(emp);
      } finally {
        await cleanupTestData(app, other.tenant.id);
      }
    });
  });

  // ── restore ─────────────────────────────────────────────────────────────────────────────────

  describe("POST /shifts/:id/restore", () => {
    const restore = (id: string, query = "") =>
      app.inject({ method: "POST", url: `/api/v1/shifts/${id}/restore${query}`, headers: auth() });
    const removed = (emp: string, dateIso: string, start: string, end: string) =>
      stored(emp, dateIso, start, end, {
        deletedAt: new Date(),
        deletedReason: "AUTO_BS_DAY_CLEANUP",
      });

    it("a removed shift on a past day cannot come back", async () => {
      const emp = await person("RestorePast");
      const gone = await removed(emp, pastDateStr(1), "08:00", "16:00");
      const res = await restore(gone.id);
      expect(res.statusCode, res.body).toBe(422);
      expect(JSON.parse(res.body)).toMatchObject({
        error: "Wiederherstellung in der Vergangenheit nicht erlaubt",
        code: "SHIFT_PAST_IMMUTABLE",
      });
      const row = await app.prisma.shift.findUniqueOrThrow({ where: { id: gone.id } });
      expect(row.deletedAt).not.toBeNull();
      expect(await auditRowsFor(app, "Shift", gone.id, "SHIFT_RESTORED")).toHaveLength(0);
    });

    it("a restore that would push the day above 10:00 is refused", async () => {
      const emp = await person("RestoreDay");
      const gone = await removed(emp, day(1), "08:00", "13:00");
      await stored(emp, day(1), "13:30", "19:30");
      const res = await restore(gone.id, "?force=true");
      expect(res.statusCode, res.body).toBe(422);
      expect(JSON.parse(res.body).code).toBe("ARBZG_VIOLATION_DAILY_MAX");
      const row = await app.prisma.shift.findUniqueOrThrow({ where: { id: gone.id } });
      expect(row.deletedAt).not.toBeNull();
    });

    it("a short rest to the next day is a forceable 409; forced, the restore writes SHIFT_RESTORED and the forced audit", async () => {
      const emp = await person("RestoreRest");
      const gone = await removed(emp, day(1), "14:00", "22:00");
      const next = await stored(emp, day(2), "06:00", "14:00");
      const refused = await restore(gone.id);
      expect(refused.statusCode, refused.body).toBe(409);
      expect(JSON.parse(refused.body)).toMatchObject({
        code: "ARBZG_VIOLATION_REST_PERIOD",
        canForce: true,
      });
      const forced = await restore(gone.id, "?force=true");
      expect(forced.statusCode, forced.body).toBe(200);
      const row = await app.prisma.shift.findUniqueOrThrow({ where: { id: gone.id } });
      expect(row.deletedAt).toBeNull();
      expect(await auditRowsFor(app, "Shift", gone.id, "SHIFT_RESTORED")).toHaveLength(1);
      const rows = await auditRowsFor(app, "Shift", gone.id, "SHIFT_FORCED_OVER_ARBZG");
      expect(rows).toHaveLength(1);
      expect(rows[0].newValue).toMatchObject({ nextShiftId: next.id });
    });

    it("a removed shift on a closed Sunday needs the override", async () => {
      const emp = await person("RestoreSunday");
      const gone = await removed(emp, day(6), "08:00", "16:00");
      const refused = await restore(gone.id);
      expect(refused.statusCode, refused.body).toBe(409);
      expect(JSON.parse(refused.body).code).toBe("SHIFT_OUTSIDE_STORE_HOURS");
      const forced = await restore(gone.id, "?force=true");
      expect(forced.statusCode, forced.body).toBe(200);
      expect(await auditRowsFor(app, "Shift", gone.id, "SHIFT_FORCED_OUTSIDE_HOURS")).toHaveLength(
        1,
      );
    });

    it("a person whose contract starts after the day gets the contract answer", async () => {
      const emp = await person("RestoreNoContract", { contractFrom: day(10) });
      const gone = await removed(emp, day(1), "08:00", "16:00");
      const res = await restore(gone.id);
      expect(res.statusCode, res.body).toBe(422);
      expect(JSON.parse(res.body)).toMatchObject({
        error: "Wiederherstellung nicht möglich",
        code: "SHIFT_NO_CONTRACT",
      });
    });

    it("a flagged-only shift keeps the no-time branch: the flag clears even on a past day", async () => {
      const emp = await person("RestoreFlag");
      const flagged = await stored(emp, pastDateStr(1), "08:00", "16:00", {
        conflictsWithLeave: true,
      });
      const res = await restore(flagged.id);
      expect(res.statusCode, res.body).toBe(200);
      const row = await app.prisma.shift.findUniqueOrThrow({ where: { id: flagged.id } });
      expect(row.conflictsWithLeave).toBe(false);
    });
  });
});
