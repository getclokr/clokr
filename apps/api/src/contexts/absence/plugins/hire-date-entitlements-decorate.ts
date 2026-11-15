import fp from "fastify-plugin";
import type { Prisma } from "@clokr/db";
import {
  LEAVE_BEFORE_HIRE_DATE_CODE,
  LEAVE_BEFORE_HIRE_DATE_MESSAGE,
  LeaveBeforeHireDateError,
  syncVacationEntitlementsForHireDateChange,
  type HireDateChange,
} from "../hire-date-entitlements";
import type { EntitlementAuditEntry } from "../entitlement-audit";

/**
 * Issue #961 — hands the hire-date reaction of Abwesenheiten to the Unterbau route
 * `PATCH /api/v1/employees/:id` WITHOUT an import, for the same two reasons as
 * `employment-exit-decorate.ts` (Issue #614): the Unterbau never imports a new symbol from a
 * business context, and `hire-date-entitlements.ts` imports `./leave-days`, a member of the
 * measured import cycle — a re-export from `contexts/absence/index.ts` would pull the employee
 * route into it. `app.ts` imports this plugin directly (the documented composition-root exception).
 *
 * `sync` runs inside the PATCH transaction (invariant-carrying); `refusal` turns the rule's own
 * refusal into the 409 body and answers `null` for any other error, so the route never names the
 * error class.
 */
declare module "fastify" {
  interface FastifyInstance {
    absenceHireDate: {
      sync: (
        tx: Prisma.TransactionClient,
        change: HireDateChange,
        audit: (entry: EntitlementAuditEntry) => Promise<void>,
      ) => Promise<{ changedEntitlementIds: string[] }>;
      refusal: (err: unknown) => { error: string; code: string } | null;
    };
  }
}

export const hireDateEntitlementsDecoratePlugin = fp(async (app) => {
  app.decorate("absenceHireDate", {
    sync: (
      tx: Prisma.TransactionClient,
      change: HireDateChange,
      audit: (entry: EntitlementAuditEntry) => Promise<void>,
    ) => syncVacationEntitlementsForHireDateChange(tx, change, audit),
    refusal: (err: unknown) =>
      err instanceof LeaveBeforeHireDateError
        ? { error: LEAVE_BEFORE_HIRE_DATE_MESSAGE, code: LEAVE_BEFORE_HIRE_DATE_CODE }
        : null,
  });
});
