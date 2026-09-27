-- CreateTable
CREATE TABLE "BankLedgerMapping" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankLedgerMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankLedgerMapping_bankAccountId_ledgerAccountId_key" ON "BankLedgerMapping"("bankAccountId", "ledgerAccountId");
CREATE INDEX "BankLedgerMapping_companyId_status_idx" ON "BankLedgerMapping"("companyId", "status");
CREATE INDEX "BankLedgerMapping_bankAccountId_status_idx" ON "BankLedgerMapping"("bankAccountId", "status");
CREATE INDEX "BankLedgerMapping_ledgerAccountId_status_idx" ON "BankLedgerMapping"("ledgerAccountId", "status");

-- AddForeignKey
ALTER TABLE "BankLedgerMapping" ADD CONSTRAINT "BankLedgerMapping_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankLedgerMapping" ADD CONSTRAINT "BankLedgerMapping_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankLedgerMapping" ADD CONSTRAINT "BankLedgerMapping_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
