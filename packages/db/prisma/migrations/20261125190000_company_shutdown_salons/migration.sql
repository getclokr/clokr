-- CreateTable
CREATE TABLE "CompanyShutdownSalon" (
    "shutdownId" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyShutdownSalon_pkey" PRIMARY KEY ("shutdownId","salonId")
);

-- CreateIndex
CREATE INDEX "CompanyShutdownSalon_salonId_idx" ON "CompanyShutdownSalon"("salonId");

-- AddForeignKey
ALTER TABLE "CompanyShutdownSalon" ADD CONSTRAINT "CompanyShutdownSalon_shutdownId_fkey" FOREIGN KEY ("shutdownId") REFERENCES "CompanyShutdown"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyShutdownSalon" ADD CONSTRAINT "CompanyShutdownSalon_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

