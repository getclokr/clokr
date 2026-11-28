/**
 * Issue #1075 — the collective roster writes (POST /shifts/bulk, POST /shifts/generate-week,
 * POST /shifts/copy-week) run the one gate `checkShiftWrite`: a generated or copied cell is skipped
 * with its reason and German message, a bulk request is refused as a whole with the failing item's
 * index, and none of them has an override. Bulk also checks every person against the planner's
 * reach, like POST. Single writes are in `shift-write-single-1075.test.ts`.
 *
 * Synthetic names only (CLAUDE.md PII rule).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { FastifyInstance } from "fastify";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
  createTestSalon,
  auditRowsFor,
} from "../../../../__tests__/setup";
import { addDaysStr, dowOf, pastDateStr, todayStr } from "../../../../__tests__/test-dates";
import {
  day,
  liveShifts,
  mkPerson,
  shiftCreateAuditCount,
  storedShift,
  type SeedData,
} from "../../../../__tests__/shift-write-fixtures-1075";
import { normalizeRolePermissions, roleNameKey } from "../../../platform";

const PAST_MESSAGE = "Schicht in der Vergangenheit ist nicht änderbar (Revisionssicherheit).";

/** Monday of week `n` after the anchor week (0 = the anchor week itself). */
const wk = (n: number): string => day(7 * n);
const mondayOf = (iso: string): string => addDaysStr(iso, -((dowOf(iso) + 6) % 7));

describe("collective shift writes — one gate (Issue #1075)", () => {
  let app: FastifyInstance;
  let data: SeedData;

  const auth = () => ({ authorization: `Bearer ${data.adminToken}` });
  const person = (label: string, opts: Parameters<typeof mkPerson>[3] = {}) =>
    mkPerson(app, data, label, opts);
  const stored = (emp: string, dateIso: string, start: string, end: string, extra = {}) =>
    storedShift(app, data, emp, dateIso, start, end, extra);

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "write1075coll");
    await app.prisma.tenantConfig.update({
      where: { tenantId: data.tenant.id },
      data: { defaultBreakOver6h: 30, defaultBreakOver9h: 45 },
    });
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("shift-write-collective-1075 cleanup failed:", err);
    }
    await closeTestApp();
  });

  // ── bulk ────────────────────────────────────────────────────────────────────────────────────

  describe("POST /shifts/bulk", () => {
    const bulk = (shifts: unknown[], query = "") =>
      app.inject({
        method: "POST",
        url: `/api/v1/shifts/bulk${query}`,
        headers: auth(),
        payload: { shifts },
      });
    const item = (employeeId: string, dateIso: string, startTime: string, endTime: string) => ({
      employeeId,
      date: dateIso,
      startTime,
      endTime,
    });

    it("a past item refuses the WHOLE batch with its index; nothing is written for anybody", async () => {
      const ok = await person("BulkOk");
      const late = await person("BulkLate");
      const auditsBefore = await shiftCreateAuditCount(app);
      const res = await bulk([
        item(ok, day(1), "08:00", "16:00"),
        item(late, pastDateStr(1), "08:00", "16:00"),
      ]);
      expect(res.statusCode, res.body).toBe(422);
      expect(JSON.parse(res.body)).toMatchObject({
        code: "SHIFT_PAST_IMMUTABLE",
        itemIndex: 1,
        error: "Schicht-Anlage in der Vergangenheit nicht erlaubt",
      });
      expect(await liveShifts(app, ok)).toHaveLength(0);
      expect(await liveShifts(app, late)).toHaveLength(0);
      expect(await shiftCreateAuditCount(app)).toBe(auditsBefore);
    });

    it("two items of one person and day count together (§ 3 ArbZG), the second is the failing index", async () => {
      const emp = await person("BulkDay");
      const res = await bulk([
        item(emp, day(1), "08:00", "13:00"),
        item(emp, day(1), "13:30", "19:30"),
      ]);
      expect(res.statusCode, res.body).toBe(422);
      expect(JSON.parse(res.body)).toMatchObject({
        code: "ARBZG_VIOLATION_DAILY_MAX",
        itemIndex: 1,
        canForce: false,
      });
      expect(await liveShifts(app, emp)).toHaveLength(0);
    });

    it("a short rest between two items is refused with canForce false, and ?force=true changes nothing", async () => {
      const emp = await person("BulkRest");
      const shifts = [item(emp, day(1), "14:00", "22:00"), item(emp, day(2), "06:00", "14:00")];
      for (const query of ["", "?force=true"]) {
        const res = await bulk(shifts, query);
        expect(res.statusCode, res.body).toBe(409);
        expect(JSON.parse(res.body)).toMatchObject({
          code: "ARBZG_VIOLATION_REST_PERIOD",
          itemIndex: 1,
          canForce: false,
        });
      }
      expect(await liveShifts(app, emp)).toHaveLength(0);
    });

    it("a closed Sunday and a missing contract refuse the batch", async () => {
      const emp = await person("BulkSunday");
      const sunday = await bulk([item(emp, day(6), "08:00", "16:00")]);
      expect(sunday.statusCode, sunday.body).toBe(409);
      expect(JSON.parse(sunday.body)).toMatchObject({
        code: "SHIFT_OUTSIDE_STORE_HOURS",
        canForce: false,
        itemIndex: 0,
      });

      const noContract = await person("BulkNoContract", { contractFrom: day(10) });
      const res = await bulk([item(noContract, day(1), "08:00", "16:00")]);
      expect(res.statusCode, res.body).toBe(422);
      expect(JSON.parse(res.body).code).toBe("SHIFT_NO_CONTRACT");
    });

    it("an item after the exit day refuses the WHOLE batch with its index; the exit day itself is created", async () => {
      const emp = await person("BulkExit", { exitDate: day(2) });
      const res = await bulk([
        item(emp, day(2), "08:00", "16:00"),
        item(emp, day(3), "08:00", "16:00"),
      ]);
      expect(res.statusCode, res.body).toBe(422);
      // A contract refusal never carries `canForce` (only the overridable rules do) — same body as
      // the pre-contract refusal of the same batch path.
      const refused = JSON.parse(res.body);
      expect(refused).toMatchObject({
        error: "Schicht-Zuweisung nicht möglich",
        code: "SHIFT_NO_CONTRACT",
        itemIndex: 1,
      });
      expect(refused).not.toHaveProperty("canForce");
      expect(await liveShifts(app, emp)).toHaveLength(0);

      const ok = await bulk([item(emp, day(2), "08:00", "16:00")]);
      expect(ok.statusCode, ok.body).toBe(201);
      expect(JSON.parse(ok.body).created).toBe(1);
    });

    it("two persons on valid future weekdays are created", async () => {
      const a = await person("BulkTwoA");
      const b = await person("BulkTwoB");
      const res = await bulk([
        item(a, day(3), "08:00", "16:00"),
        item(b, day(3), "09:00", "17:00"),
      ]);
      expect(res.statusCode, res.body).toBe(201);
      expect(JSON.parse(res.body).created).toBe(2);
    });
  });

  // ── bulk — the planner's reach ──────────────────────────────────────────────────────────────

  describe("POST /shifts/bulk — each person against the planner's reach, like POST", () => {
    let salonA: { id: string };
    let salonB: { id: string };
    let plannerToken: string;
    let inA: string;
    let onlyInB: string;

    async function homeIn(employeeId: string, salonId: string) {
      await app.prisma.employeeSalonAssignment.deleteMany({ where: { employeeId } });
      await app.prisma.employeeSalonAssignment.create({
        data: {
          tenantId: data.tenant.id,
          employeeId,
          salonId,
          kind: "HOME",
          validFrom: new Date("2024-09-01T00:00:00Z"),
          validUntil: null,
          weekdays: [],
        },
      });
    }

    beforeAll(async () => {
      salonA = await createTestSalon(app.prisma, data.tenant.id, { name: "Reach Salon A" });
      salonB = await createTestSalon(app.prisma, data.tenant.id, { name: "Reach Salon B" });
      inA = await person("ReachInA");
      onlyInB = await person("ReachOnlyInB");
      await homeIn(inA, salonA.id);
      await homeIn(onlyInB, salonB.id);

      const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const user = await app.prisma.user.create({
        data: {
          email: `reach-planner-${suffix}@example.invalid`,
          passwordHash: await bcrypt.hash("test1234", 4),
          isActive: true,
        },
      });
      await app.prisma.employee.create({
        data: {
          tenantId: data.tenant.id,
          userId: user.id,
          employeeNumber: `RP${suffix}`.toUpperCase().slice(0, 20),
          firstName: "ReachPlanner",
          lastName: "Write1075",
          hireDate: new Date("2024-09-01T00:00:00Z"),
        },
      });
      const roleName = `Reach1075 ${crypto.randomBytes(3).toString("hex")}`;
      const role = await app.prisma.accessRole.create({
        data: {
          tenantId: data.tenant.id,
          name: roleName,
          nameKey: roleNameKey(roleName),
          permissions: normalizeRolePermissions(["shift:plan:ZUGEWIESEN"]),
        },
      });
      await app.prisma.roleAssignment.create({
        data: {
          tenantId: data.tenant.id,
          userId: user.id,
          accessRoleId: role.id,
          scopeType: "SALONS",
          salonIds: [salonA.id],
          employeeIds: [],
        },
      });
      const login = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: user.email, password: "test1234" },
      });
      expect(login.statusCode, login.body).toBe(200);
      plannerToken = (JSON.parse(login.body) as { accessToken: string }).accessToken;
    });

    const asPlanner = (method: "POST", url: string, payload: Record<string, unknown>) =>
      app.inject({ method, url, headers: { authorization: `Bearer ${plannerToken}` }, payload });

    it("an item for a person only in another salon is refused exactly like POST refuses it, nothing is written", async () => {
      const single = await asPlanner("POST", "/api/v1/shifts", {
        employeeId: onlyInB,
        date: day(1),
        startTime: "08:00",
        endTime: "16:00",
      });
      const auditsBefore = await shiftCreateAuditCount(app);

      const res = await asPlanner("POST", "/api/v1/shifts/bulk", {
        shifts: [
          { employeeId: inA, date: day(1), startTime: "08:00", endTime: "16:00" },
          { employeeId: onlyInB, date: day(1), startTime: "08:00", endTime: "16:00" },
        ],
      });
      expect(res.statusCode, res.body).toBe(single.statusCode);
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body)).toEqual(JSON.parse(single.body));

      // the whole batch is refused: the in-reach item is not written either
      expect(await liveShifts(app, inA)).toHaveLength(0);
      expect(await liveShifts(app, onlyInB)).toHaveLength(0);
      expect(await shiftCreateAuditCount(app)).toBe(auditsBefore);
      expect(await auditRowsFor(app, "Employee", onlyInB, "SCOPE_ACCESS_DENIED")).not.toHaveLength(
        0,
      );
    });

    it("a batch inside the reach is created", async () => {
      const res = await asPlanner("POST", "/api/v1/shifts/bulk", {
        shifts: [{ employeeId: inA, date: day(2), startTime: "08:00", endTime: "16:00" }],
      });
      expect(res.statusCode, res.body).toBe(201);
      expect(await liveShifts(app, inA)).toHaveLength(1);
    });
  });

  // ── generate-week ───────────────────────────────────────────────────────────────────────────

  describe("POST /shifts/generate-week", () => {
    afterEach(async () => {
      await app.prisma.employeeShiftPattern.deleteMany({
        where: { employee: { tenantId: data.tenant.id } },
      });
    });

    async function template(name: string, start: string, end: string) {
      return app.prisma.shiftTemplate.create({
        data: { tenantId: data.tenant.id, name, startTime: start, endTime: end },
      });
    }
    async function pattern(employeeId: string, templateId: string, dayOfWeek: number) {
      await app.prisma.employeeShiftPattern.create({
        data: {
          employeeId,
          dayOfWeek,
          templateId,
          isActive: true,
          validFrom: new Date("2024-09-01T00:00:00Z"),
        },
      });
    }
    const generate = (weekStart: string, commit: boolean) =>
      app.inject({
        method: "POST",
        url: "/api/v1/shifts/generate-week",
        headers: auth(),
        payload: { weekStart, commit },
      });
    type Cell = { employeeId: string; date: string; reason?: string; message?: string };

    it("the cell of a past day is skipped with 'past'; a commit writes no row before today", async () => {
      const emp = await person("GenPast");
      const tpl = await template("Gen-Past", "08:00", "16:00");
      for (const dow of [0, 1, 2, 3, 4, 5, 6]) await pattern(emp, tpl.id, dow);
      const week = mondayOf(pastDateStr(1));

      const preview = JSON.parse((await generate(week, false)).body) as {
        create: Cell[];
        skip: Cell[];
      };
      const past = preview.skip.find((s) => s.employeeId === emp && s.date === pastDateStr(1));
      expect(past).toMatchObject({ reason: "past", message: PAST_MESSAGE });
      expect(preview.create.filter((c) => c.employeeId === emp && c.date < todayStr())).toEqual([]);

      const commit = await generate(week, true);
      expect(commit.statusCode, commit.body).toBe(200);
      const rows = await liveShifts(app, emp);
      expect(rows.filter((r) => r.date.toISOString().slice(0, 10) < todayStr())).toEqual([]);
    });

    it("skips a closed day, a day before the contract, a short rest and a long day — each with reason and message, preview and commit alike", async () => {
      const tplNormal = await template("Gen-Normal", "08:00", "16:00");
      const tplLong = await template("Gen-Long", "07:30", "18:30");
      const week = wk(2);

      // closed Sunday + contract that starts on that week's Wednesday
      const lateContract = await person("GenContract", { contractFrom: addDaysStr(week, 2) });
      for (const dow of [0, 1, 2, 3, 4, 6]) await pattern(lateContract, tplNormal.id, dow);

      // stored Tuesday 14:00-23:00 -> Wednesday 08:00 follows after 9 h
      const rest = await person("GenRest");
      await stored(rest, addDaysStr(week, 1), "14:00", "23:00");
      for (const dow of [1, 2]) await pattern(rest, tplNormal.id, dow);

      // a template of 10:15 net on every open day
      const long = await person("GenLong");
      for (const dow of [0, 1, 2, 3, 4, 5, 6]) await pattern(long, tplLong.id, dow);

      const preview = JSON.parse((await generate(week, false)).body) as {
        create: Cell[];
        skip: Cell[];
      };
      const mine = (emp: string, list: Cell[]) => list.filter((c) => c.employeeId === emp);
      const reasonOn = (emp: string, offset: number) =>
        preview.skip.find((s) => s.employeeId === emp && s.date === addDaysStr(week, offset))
          ?.reason;

      expect(reasonOn(lateContract, 0)).toBe("no-contract");
      expect(reasonOn(lateContract, 1)).toBe("no-contract");
      expect(mine(lateContract, preview.create).map((c) => c.date)).toEqual([
        addDaysStr(week, 2),
        addDaysStr(week, 3),
        addDaysStr(week, 4),
      ]);
      expect(reasonOn(lateContract, 6)).toBe("outside-store-hours");
      expect(
        preview.skip.find((s) => s.employeeId === lateContract && s.date === addDaysStr(week, 6))
          ?.message,
      ).toContain("geschlossen");

      expect(reasonOn(rest, 1)).toBe("existing");
      expect(reasonOn(rest, 2)).toBe("arbzg-rest-period");
      expect(mine(rest, preview.create)).toEqual([]);

      for (const offset of [0, 1, 2, 3, 4, 5]) {
        expect(reasonOn(long, offset), `day ${offset}`).toBe("arbzg-daily-max");
      }
      expect(reasonOn(long, 6)).toBe("outside-store-hours");
      expect(mine(long, preview.create)).toEqual([]);

      for (const s of [...mine(lateContract, preview.skip), ...mine(long, preview.skip)]) {
        if (s.reason === "no-pattern") continue;
        expect(s.message, `${s.date} ${s.reason}`).toBeTruthy();
      }

      const commit = JSON.parse((await generate(week, true)).body) as {
        create: Cell[];
        skip: Cell[];
        committed: boolean;
      };
      expect(commit.committed).toBe(true);
      const ours = new Set([lateContract, rest, long]);
      const onlyOurs = (list: Cell[]) => list.filter((c) => ours.has(c.employeeId));
      expect(onlyOurs(commit.skip)).toEqual(onlyOurs(preview.skip));
      expect(await liveShifts(app, long)).toHaveLength(0);
      expect(
        (await liveShifts(app, lateContract)).map((r) => r.date.toISOString().slice(0, 10)),
      ).toEqual([addDaysStr(week, 2), addDaysStr(week, 3), addDaysStr(week, 4)]);
    });

    it("generates the exit day and skips the days after it (existing 'no-pattern' skip answers first)", async () => {
      const tpl = await template("Gen-Exit", "08:00", "16:00");
      const week = wk(3);
      const emp = await person("GenExit", { exitDate: addDaysStr(week, 2) });
      for (const dow of [0, 1, 2, 3, 4]) await pattern(emp, tpl.id, dow);
      const expected = [0, 1, 2].map((i) => addDaysStr(week, i));

      const preview = JSON.parse((await generate(week, false)).body) as {
        create: Cell[];
        skip: Cell[];
      };
      expect(preview.create.filter((c) => c.employeeId === emp).map((c) => c.date)).toEqual(
        expected,
      );
      for (const offset of [3, 4]) {
        expect(
          preview.skip.find((s) => s.employeeId === emp && s.date === addDaysStr(week, offset))
            ?.reason,
          `day ${offset}`,
        ).toBe("no-pattern");
      }

      const commit = await generate(week, true);
      expect(commit.statusCode, commit.body).toBe(200);
      expect((await liveShifts(app, emp)).map((r) => r.date.toISOString().slice(0, 10))).toEqual(
        expected,
      );
    });

    it("a person whose exit day is the Monday of the week still gets that Monday, and nothing after it", async () => {
      const tpl = await template("Gen-ExitMon", "08:00", "16:00");
      const week = wk(4);
      const emp = await person("GenExitMon", { exitDate: week });
      for (const dow of [0, 1, 2, 3, 4]) await pattern(emp, tpl.id, dow);

      const preview = JSON.parse((await generate(week, false)).body) as {
        create: Cell[];
        skip: Cell[];
      };
      expect(preview.create.filter((c) => c.employeeId === emp).map((c) => c.date)).toEqual([week]);
      expect(
        preview.skip.find((s) => s.employeeId === emp && s.date === addDaysStr(week, 1))?.reason,
      ).toBe("no-pattern");

      const commit = await generate(week, true);
      expect(commit.statusCode, commit.body).toBe(200);
      expect((await liveShifts(app, emp)).map((r) => r.date.toISOString().slice(0, 10))).toEqual([
        week,
      ]);
    });
  });

  // ── copy-week ───────────────────────────────────────────────────────────────────────────────

  describe("POST /shifts/copy-week", () => {
    const copy = (source: string, target: string, commit: boolean) =>
      app.inject({
        method: "POST",
        url: "/api/v1/shifts/copy-week",
        headers: auth(),
        payload: { sourceWeekStart: source, targetWeekStart: target, commit },
      });
    type Cell = { employeeId: string; date: string; reason?: string; message?: string };
    type Answer = { create: Cell[]; skip: Cell[]; committed: boolean };

    it("copying into the week of a past day skips that day with 'past'; no row before today is written", async () => {
      const emp = await person("CopyPast");
      const target = mondayOf(pastDateStr(1));
      const source = addDaysStr(target, -7);
      for (let i = 0; i < 7; i++) await stored(emp, addDaysStr(source, i), "08:00", "16:00");

      const preview = JSON.parse((await copy(source, target, false)).body) as Answer;
      expect(
        preview.skip.find((s) => s.employeeId === emp && s.date === pastDateStr(1)),
      ).toMatchObject({ reason: "past", message: PAST_MESSAGE });

      const commit = await copy(source, target, true);
      expect(commit.statusCode, commit.body).toBe(200);
      const rows = await liveShifts(app, emp);
      expect(
        rows.filter(
          (r) =>
            r.date.toISOString().slice(0, 10) >= target &&
            r.date.toISOString().slice(0, 10) < todayStr(),
        ),
      ).toEqual([]);
    });

    it("a split day copies the first shift and skips the second against § 3 ArbZG", async () => {
      const emp = await person("CopySplit");
      const source = wk(6);
      const target = wk(7);
      await stored(emp, addDaysStr(source, 1), "08:00", "13:00");
      await stored(emp, addDaysStr(source, 1), "13:30", "19:30");
      const preview = JSON.parse((await copy(source, target, false)).body) as Answer;
      const mine = (list: Cell[]) => list.filter((c) => c.employeeId === emp);
      expect(mine(preview.create)).toHaveLength(1);
      expect(mine(preview.skip)).toEqual([
        expect.objectContaining({ date: addDaysStr(target, 1), reason: "arbzg-daily-max" }),
      ]);
      expect(mine(preview.skip)[0].message).toContain("§ 3 ArbZG");
    });

    it("a short rest to a stored next-day shift skips the cell (forward direction)", async () => {
      const emp = await person("CopyRest");
      const source = wk(8);
      const target = wk(9);
      await stored(emp, addDaysStr(source, 1), "14:00", "22:00");
      await stored(emp, addDaysStr(source, 2), "06:00", "14:00");
      await stored(emp, addDaysStr(target, 2), "06:00", "14:00");
      const preview = JSON.parse((await copy(source, target, false)).body) as Answer;
      const skips = preview.skip.filter((c) => c.employeeId === emp);
      expect(skips.find((s) => s.date === addDaysStr(target, 1))?.reason).toBe("arbzg-rest-period");
      expect(skips.find((s) => s.date === addDaysStr(target, 2))?.reason).toBe("existing");
      expect(preview.create.filter((c) => c.employeeId === emp)).toEqual([]);
    });

    it("a Sunday and the days before a contract start are skipped with their reasons, the rest is copied", async () => {
      const closed = await person("CopySunday");
      const lateContract = await person("CopyContract");
      const source = wk(10);
      const target = wk(11);
      await stored(closed, addDaysStr(source, 6), "08:00", "16:00");
      await app.prisma.workSchedule.deleteMany({ where: { employeeId: lateContract } });
      await app.prisma.workSchedule.create({
        data: {
          employeeId: lateContract,
          type: "SHIFT_BASED",
          weeklyHours: 40,
          validFrom: new Date(`${addDaysStr(target, 2)}T00:00:00Z`),
        },
      });
      for (const i of [0, 1, 2])
        await stored(lateContract, addDaysStr(source, i), "08:00", "16:00");

      const preview = JSON.parse((await copy(source, target, false)).body) as Answer;
      expect(
        preview.skip.find((s) => s.employeeId === closed && s.date === addDaysStr(target, 6)),
      ).toMatchObject({ reason: "outside-store-hours" });
      const late = preview.skip.filter((s) => s.employeeId === lateContract);
      expect(late.map((s) => [s.date, s.reason])).toEqual([
        [addDaysStr(target, 0), "no-contract"],
        [addDaysStr(target, 1), "no-contract"],
      ]);
      expect(
        preview.create.filter((c) => c.employeeId === lateContract).map((c) => c.date),
      ).toEqual([addDaysStr(target, 2)]);

      const commit = JSON.parse((await copy(source, target, true)).body) as Answer;
      expect(commit.committed).toBe(true);
      expect(
        (await liveShifts(app, lateContract)).map((r) => r.date.toISOString().slice(0, 10)),
      ).toEqual([
        addDaysStr(source, 0),
        addDaysStr(source, 1),
        addDaysStr(source, 2),
        addDaysStr(target, 2),
      ]);
    });

    it("target days after the exit day are skipped with 'no-contract', the exit day is copied", async () => {
      const source = wk(14);
      const target = wk(15);
      const emp = await person("CopyExit", { exitDate: addDaysStr(target, 1) });
      for (const i of [0, 1, 2]) await stored(emp, addDaysStr(source, i), "08:00", "16:00");

      const preview = JSON.parse((await copy(source, target, false)).body) as Answer;
      const mine = (list: Cell[]) => list.filter((c) => c.employeeId === emp);
      expect(mine(preview.create).map((c) => c.date)).toEqual([
        addDaysStr(target, 0),
        addDaysStr(target, 1),
      ]);
      expect(mine(preview.skip)).toEqual([
        expect.objectContaining({
          date: addDaysStr(target, 2),
          reason: "no-contract",
          message: "Für diese Person gilt an diesem Tag kein Vertrag.",
        }),
      ]);

      const commit = await copy(source, target, true);
      expect(commit.statusCode, commit.body).toBe(200);
      expect((await liveShifts(app, emp)).map((r) => r.date.toISOString().slice(0, 10))).toEqual([
        addDaysStr(source, 0),
        addDaysStr(source, 1),
        addDaysStr(source, 2),
        addDaysStr(target, 0),
        addDaysStr(target, 1),
      ]);
    });

    it("two skips of one person, day and reason come back as two entries", async () => {
      const emp = await person("CopyTwice");
      const source = wk(12);
      const target = wk(13);
      await stored(emp, addDaysStr(source, 2), "08:00", "12:00");
      await stored(emp, addDaysStr(source, 2), "13:00", "17:00");
      await stored(emp, addDaysStr(target, 2), "09:00", "10:00");
      const preview = JSON.parse((await copy(source, target, false)).body) as Answer;
      const existing = preview.skip.filter(
        (s) => s.employeeId === emp && s.date === addDaysStr(target, 2) && s.reason === "existing",
      );
      expect(existing).toHaveLength(2);
    });
  });
});
