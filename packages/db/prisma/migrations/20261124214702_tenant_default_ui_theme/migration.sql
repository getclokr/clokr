-- Issue #976: tenant default Farbwelt. Additive; existing tenants keep PFLAUME. Not audit-relevant DDL.

-- CreateEnum
CREATE TYPE "UiTheme" AS ENUM ('PFLAUME', 'SALZ', 'PETROL');

-- AlterTable
ALTER TABLE "TenantConfig" ADD COLUMN     "defaultUiTheme" "UiTheme" NOT NULL DEFAULT 'PFLAUME';
