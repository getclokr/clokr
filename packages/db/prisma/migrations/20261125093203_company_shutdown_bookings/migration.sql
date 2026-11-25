-- AlterEnum
ALTER TYPE "LeaveTypeCode" ADD VALUE 'COMPANY_SHUTDOWN';

-- AlterTable
ALTER TABLE "Absence" ADD COLUMN     "companyShutdownId" TEXT;

-- AlterTable
ALTER TABLE "CompanyShutdown" ADD COLUMN     "deletedAt" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "companyShutdownId" TEXT;

-- CreateIndex
CREATE INDEX "Absence_companyShutdownId_idx" ON "Absence"("companyShutdownId");

-- CreateIndex
CREATE INDEX "LeaveRequest_companyShutdownId_idx" ON "LeaveRequest"("companyShutdownId");

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_companyShutdownId_fkey" FOREIGN KEY ("companyShutdownId") REFERENCES "CompanyShutdown"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_companyShutdownId_fkey" FOREIGN KEY ("companyShutdownId") REFERENCES "CompanyShutdown"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

