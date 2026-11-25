import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";
import { bookCompanyShutdownsForHire, resolveShutdownActor } from "../company-shutdown/booking";

/**
 * Issue #1069 (O-6, D-18) - hands "a person created later gets the Betriebsurlaub booked" to the
 * Unterbau routes `POST /api/v1/employees` and `POST /api/v1/imports/employees` WITHOUT an import,
 * for the same two reasons as `employment-exit-decorate.ts` (Issue #614): the Unterbau never
 * imports a new symbol from a business context, and `company-shutdown/booking.ts` imports
 * `../leave-request-create` and `../../working-time-account`, members of the measured import cycle
 * - an `index.ts` re-export would pull the employee routes into it (cap 22). `app.ts` imports this
 * plugin directly (the documented composition-root exception), so registering it adds no
 * cross-context import edge.
 *
 * REACTIVE (ADR 0002 Entscheidung 10): called after the creation transaction has committed, it
 * never throws and never changes the creation answer. A failure is logged with the tenant and
 * employee id only; the read-only Bestand script (`scripts/audit-1069-company-shutdown-bookings.ts`)
 * lists a booking that is missing. A later change of the hire date does not re-book (documented
 * limit, ADR entry of #1069).
 */
declare module "fastify" {
  interface FastifyInstance {
    companyShutdownHire: {
      bookForNewEmployee: (input: {
        tenantId: string;
        employeeId: string;
        /** The request of the person creating the employee: the actor and the audit meta. */
        req: FastifyRequest;
      }) => Promise<void>;
    };
  }
}

export const companyShutdownHireDecoratePlugin = fp(async (app) => {
  app.decorate("companyShutdownHire", {
    bookForNewEmployee: async ({
      tenantId,
      employeeId,
      req,
    }: {
      tenantId: string;
      employeeId: string;
      req: FastifyRequest;
    }) => {
      try {
        await bookCompanyShutdownsForHire(app, {
          tenantId,
          employeeId,
          resolveActor: () => resolveShutdownActor(app, req),
          request: { ip: req.ip, headers: req.headers as Record<string, string> },
        });
      } catch (err) {
        app.log.error(
          { err, tenantId, employeeId },
          "Betriebsurlaub konnte für die neue Person nicht gebucht werden",
        );
      }
    },
  });
});
