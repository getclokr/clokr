/**
 * minor-day-notice.ts — Issue #655: the notice about a minor's JArbSchG finding after a clock STOP.
 *
 * Clocking (web, NFC terminal, WLAN) is never refused or delayed for a JArbSchG finding: the record
 * must show the real time, and a refused clock-out would leave the entry open or wrong. § 58
 * JArbSchG addresses the employer, so after every STOP the whole day of a person under 18 is
 * evaluated with the kernels the manual paths use and the responsible persons are told.
 *
 *   § 8  JArbSchG  the JARBSCHG_* findings of `checkArbZG` (day and ISO week, Issue #524)
 *   § 9  JArbSchG  `checkJArbSchG` over the whole day total (`otherWorkingMinutesOfDay`, no
 *                  `excludeEntryId`, the Issue #70 rule)
 *
 * The notice is reactive (ADR 0002, Entscheidung 10): it runs after the committed STOP, its failure
 * is logged by the caller and never fails the punch. Recipients, redaction and dedup follow the
 * next-day break-finding job (Feature 10 of the attendance checker, Issue #80 / #511):
 *
 *   - holders of `time-entry:update:ZUGEWIESEN` whose reach covers at least one closed entry of the
 *     day; never the person;
 *   - the full text only where the reach covers every entry of the evidence window (the ISO week
 *     for a § 8 finding, the day for a § 9-only finding), otherwise the neutral withheld notice;
 *   - ONE row per recipient, person and day ever (a dismissed row counts).
 *
 * The § 9 sentence names the breach only; it never asks anyone to shorten the entry, because the
 * recorded time is the true time.
 */
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@clokr/db";
import { checkJArbSchG, isMinorAtDate } from "../absence";
import { resolveScopedHolderIds, userIdsHoldingPermission } from "../platform";
import { weekDateRange } from "../working-time-account";
import { checkArbZG } from "./arbzg";
import { buildWithheldNotice } from "./break-finding-notice";
import { dayCoverage } from "./day-scope";
import { findEntriesOfDay, otherWorkingMinutesOfDay } from "./day-entries";

/** Neutral title; also the email subject, because a subject travels further than a body. */
export const MINOR_DAY_NOTICE_TITLE = "Hinweis Jugendarbeitsschutz";

/** The § 9 finding of a day; names the breach, never asks to shorten the (true) record. */
export const SECTION9_DAY_NOTICE_TEXT =
  "§ 9 Abs. 1 Satz 2 Nr. 2 JArbSchG: An einem Berufsschultag mit mehr als fünf Unterrichtsstunden dürfen Jugendliche nicht beschäftigt werden; für diesen Tag ist mehr Arbeit erfasst als zulässig.";

const NOTICE_TYPE_CODES = ["JARBSCHG_DAILY_MAX_EXCEEDED", "JARBSCHG_WEEKLY_MAX_EXCEEDED"];

/** "2026-03-10" -> "10.03.2026". */
function germanDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
}

/** The full notice: "<name>: Am DD.MM.YYYY <finding messages joined by a space>". */
export function buildMinorDayNotice(input: {
  employeeName: string;
  /** Calendar day, "YYYY-MM-DD". */
  date: string;
  findingMessages: readonly string[];
}): { title: string; message: string } {
  return {
    title: MINOR_DAY_NOTICE_TITLE,
    message: `${input.employeeName}: Am ${germanDate(input.date)} ${input.findingMessages.join(" ")}`,
  };
}

/**
 * The finding messages of one day of a person: the § 8 findings of `checkArbZG` (in its order),
 * then the § 9 sentence when the day total breaches § 9 Abs. 1 Satz 2 Nr. 2. The same kernels the
 * manual paths call; the caller decides whether the person is a minor.
 */
export async function minorDayFindingMessages(
  db: PrismaClient,
  input: { tenantId: string; employeeId: string; date: Date },
): Promise<string[]> {
  const { tenantId, employeeId, date } = input;
  const messages = (await checkArbZG(db, employeeId, date))
    .filter((w) => NOTICE_TYPE_CODES.includes(w.code))
    .map((w) => w.message);
  const section9 = await checkJArbSchG(db, {
    employeeId,
    date,
    plannedNetWorkMin: await otherWorkingMinutesOfDay(db, { tenantId, employeeId, date }),
  });
  if (section9.blocked) messages.push(SECTION9_DAY_NOTICE_TEXT);
  return messages;
}

/**
 * The post-STOP notice of Issue #655. Adults and people without a birth date cost two reads and
 * produce nothing (the regime follows the changed day, like the § 11 break regime).
 */
export async function notifyMinorDayFindingsAfterClockStop(
  app: FastifyInstance,
  params: { entryId: string; employeeId: string; tz: string },
): Promise<void> {
  const { entryId, employeeId, tz } = params;
  const entry = await app.prisma.timeEntry.findUnique({
    where: { id: entryId },
    select: { date: true },
  });
  const employee = await app.prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      tenantId: true,
      firstName: true,
      lastName: true,
      userId: true,
      birthDate: true,
      isTimeTrackingExempt: true,
    },
  });
  if (!entry || !employee || employee.isTimeTrackingExempt) return;
  if (!isMinorAtDate(employee.birthDate, entry.date)) return;

  const { tenantId } = employee;
  const dayIso = entry.date.toISOString().slice(0, 10);
  const messages = await minorDayFindingMessages(app.prisma, {
    tenantId,
    employeeId,
    date: entry.date,
  });
  if (messages.length === 0) return;

  // Evidence rows: the closed WORK entries of the day (who is told) and every entry of the ISO week
  // (who may read the § 8 figures, which sum the whole week).
  const dayRows = (await findEntriesOfDay(app.prisma, { tenantId, employeeId, date: entry.date }))
    .filter((r) => r.type === "WORK" && r.endTime !== null)
    .map((r) => ({ salonId: r.salonId, employeeId: r.employeeId, date: r.date }));
  const { firstDay: weekStart, lastDay: weekEnd } = weekDateRange(
    new Date(`${dayIso}T12:00:00Z`),
    tz,
  );
  const weekRows = await app.prisma.timeEntry.findMany({
    where: {
      employeeId,
      employee: { tenantId },
      deletedAt: null,
      date: { gte: weekStart, lte: weekEnd },
    },
    select: { salonId: true, employeeId: true, date: true },
  });
  const hasSection8 = messages.some((m) => m !== SECTION9_DAY_NOTICE_TEXT);
  const detailRows = hasSection8 ? weekRows : dayRows;

  // One holder lookup, kept on one line so the recipient-site audit can grep the exact call.
  // prettier-ignore
  const holders = await userIdsHoldingPermission(app.prisma, tenantId, "time-entry:update:ZUGEWIESEN");
  if (holders.length === 0) return;
  const activeHolders = new Set(
    (
      await app.prisma.employee.findMany({
        where: { tenantId, user: { isActive: true, id: { in: holders } } },
        select: { userId: true },
      })
    ).map((e) => e.userId),
  );
  const candidateHolders = holders.filter((id) => activeHolders.has(id));

  const recipients = await resolveScopedHolderIds(
    app.prisma,
    tenantId,
    candidateHolders,
    "time-entry:update:ZUGEWIESEN",
    async (reach) => (await dayCoverage(app.prisma, tenantId, reach, dayRows)) !== "none",
  );
  const fullDetail = new Set(
    await resolveScopedHolderIds(
      app.prisma,
      tenantId,
      recipients,
      "time-entry:update:ZUGEWIESEN",
      async (reach) => (await dayCoverage(app.prisma, tenantId, reach, detailRows)) === "all",
    ),
  );

  const relatedId = `${employeeId}:${dayIso}`;
  const employeeName = `${employee.firstName} ${employee.lastName}`;
  for (const userId of recipients) {
    if (userId === employee.userId) continue; // managers only
    // Any existing row — dismissed or not — means this recipient was told already.
    const existing = await app.prisma.notification.findFirst({
      where: { userId, type: "JARBSCHG_DAY_VIOLATION", relatedType: "EmployeeDay", relatedId },
      select: { id: true },
    });
    if (existing) continue;

    const full = fullDetail.has(userId);
    const { title, message } = full
      ? buildMinorDayNotice({ employeeName, date: dayIso, findingMessages: messages })
      : buildWithheldNotice({ employeeName, date: dayIso });
    try {
      await app.notify({
        userId,
        type: "JARBSCHG_DAY_VIOLATION",
        title,
        message,
        link: `/team/time-entries?employeeId=${employeeId}&date=${dayIso}`,
        tenantId,
        relatedType: "EmployeeDay",
        relatedId,
        emailSubject: title, // neutral subject: a subject travels further than a body
      });
    } catch (err) {
      // One recipient's failure never withholds the notice from the others; no row was written, so
      // the next STOP of the day tries this recipient again.
      app.log.error({ err, userId, employeeId, date: dayIso }, "JArbSchG notice delivery failed");
      continue;
    }
    app.log.info(
      { userId, employeeId, date: dayIso, detail: full ? "full" : "redacted" },
      "Jugendarbeitsschutz-Hinweis gemeldet",
    );
  }
}
