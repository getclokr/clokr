import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";
import {
  rebookCompanyShutdownsForHomeSalonChange,
  resolveShutdownActor,
} from "../company-shutdown/booking";

/**
 * Issue #1079 (D-07) - hands "a Stammsalon change re-books the person for the salon-scoped
 * Betriebsurlaube" to the Unterbau route `POST /api/v1/employees/:id/salon-assignments/home`
 * WITHOUT an import, for the same reasons as `company-shutdown-hire-decorate.ts` (Issue #1069): the
 * Unterbau never imports a new symbol from a business context, and `company-shutdown/booking.ts`
 * imports members of the measured import cycle (cap 22). `app.ts` imports this plugin directly (the
 * documented composition-root exception), so registering it adds no cross-context import edge.
 *
 * REACTIVE (ADR 0002 Entscheidung 10): called after the change has committed, it never throws and
 * never changes the route's answer. A failure is logged with the tenant and employee id only; the
 * read-only Bestand script (`scripts/audit-1069-company-shutdown-bookings.ts`) lists what is
 * missing. A hire-date change does not re-book (the documented #1069 D-18 limit).
 */
declare module "fastify" {
  interface FastifyInstance {
    companyShutdownHomeSalon: {
      rebookForHomeSalonChange: (input: {
        tenantId: string;
        employeeId: string;
        /** First day of the new Stammsalon, `YYYY-MM-DD`. */
        fromDay: string;
        /** The request of the person changing the Stammsalon: the actor and the audit meta. */
        req: FastifyRequest;
      }) => Promise<void>;
    };
  }
}

export const companyShutdownHomeSalonDecoratePlugin = fp(async (app) => {
  app.decorate("companyShutdownHomeSalon", {
    rebookForHomeSalonChange: async ({
      tenantId,
      employeeId,
      fromDay,
      req,
    }: {
      tenantId: string;
      employeeId: string;
      fromDay: string;
      req: FastifyRequest;
    }) => {
      try {
        await rebookCompanyShutdownsForHomeSalonChange(app, {
          tenantId,
          employeeId,
          fromDay,
          resolveActor: () => resolveShutdownActor(app, req),
          request: { ip: req.ip, headers: req.headers as Record<string, string> },
        });
      } catch (err) {
        app.log.error(
          { err, tenantId, employeeId },
          "Betriebsurlaub konnte nach dem Wechsel des Stammsalons nicht neu gebucht werden",
        );
      }
    },
  });
});
