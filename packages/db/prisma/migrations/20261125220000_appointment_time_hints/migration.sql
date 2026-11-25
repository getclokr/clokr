-- CreateEnum
CREATE TYPE "AppointmentHintKind" AS ENUM ('AFTER_CLOCK_OUT', 'NO_ENTRY');

-- AlterTable
ALTER TABLE "TenantConfig" ADD COLUMN     "appointmentTimeHintsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AppointmentHintDismissal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "AppointmentHintKind" NOT NULL,
    "dismissedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentHintDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppointmentHintDismissal_tenantId_date_idx" ON "AppointmentHintDismissal"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentHintDismissal_employeeId_date_kind_key" ON "AppointmentHintDismissal"("employeeId", "date", "kind");

-- AddForeignKey
ALTER TABLE "AppointmentHintDismissal" ADD CONSTRAINT "AppointmentHintDismissal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentHintDismissal" ADD CONSTRAINT "AppointmentHintDismissal_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

