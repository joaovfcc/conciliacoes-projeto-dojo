-- CreateIndex
CREATE UNIQUE INDEX "Company_organizationId_id_key" ON "Company"("organizationId", "id");

-- CreateTable
CREATE TABLE "CompletedReconciliation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "confirmation" JSONB NOT NULL,
    "sourceFiles" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "processingAttemptId" TEXT,
    "processingGeneration" INTEGER,
    CONSTRAINT "CompletedReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompletedReconciliation_organizationId_completedAt_idx" ON "CompletedReconciliation"("organizationId", "completedAt");
CREATE INDEX "CompletedReconciliation_companyId_completedAt_idx" ON "CompletedReconciliation"("companyId", "completedAt");
CREATE INDEX "CompletedReconciliation_userId_completedAt_idx" ON "CompletedReconciliation"("userId", "completedAt");
CREATE INDEX "CompletedReconciliation_expiresAt_idx" ON "CompletedReconciliation"("expiresAt");

-- AddForeignKey
ALTER TABLE "CompletedReconciliation" ADD CONSTRAINT "CompletedReconciliation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ConfigOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompletedReconciliation" ADD CONSTRAINT "CompletedReconciliation_organizationId_companyId_fkey" FOREIGN KEY ("organizationId", "companyId") REFERENCES "Company"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompletedReconciliation" ADD CONSTRAINT "CompletedReconciliation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
