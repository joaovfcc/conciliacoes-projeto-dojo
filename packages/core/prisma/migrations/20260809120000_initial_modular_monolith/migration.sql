-- CreateEnum
CREATE TYPE "ActiveStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CHECKING', 'SAVINGS', 'INVESTMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('RECEIVED', 'READING', 'LAYOUT_DETECTED', 'PARSING', 'NEEDS_MAPPING', 'PARSED_WITH_WARNINGS', 'VALIDATED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LayoutStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('PREPARING', 'READY_FOR_REVIEW', 'UNDER_REVIEW', 'REJECTED', 'APPROVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('OPEN', 'ASSIGNED', 'UNDER_REVIEW', 'RESOLVED', 'ACCEPTED_TIMING_DIFFERENCE', 'REJECTED');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "documentNumber" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'BRL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyAccess" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "roles" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankCode" TEXT,
    "bankName" TEXT,
    "agency" TEXT,
    "accountNumber" TEXT,
    "accountDigit" TEXT,
    "accountType" "AccountType" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationProfile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "matchTypeId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "amountTolerance" DECIMAL(20,2) NOT NULL,
    "dateToleranceDays" INTEGER NOT NULL,
    "preparerId" TEXT,
    "reviewerIds" TEXT[],
    "materialityThreshold" DECIMAL(20,2),
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationProfileLedgerAccount" (
    "reconciliationProfileId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,

    CONSTRAINT "ReconciliationProfileLedgerAccount_pkey" PRIMARY KEY ("reconciliationProfileId","ledgerAccountId")
);

-- CreateTable
CREATE TABLE "ReconciliationPolicy" (
    "id" TEXT NOT NULL,
    "reconciliationProfileId" TEXT NOT NULL,
    "matchingStrategy" TEXT NOT NULL,
    "dateToleranceDays" INTEGER NOT NULL,
    "amountTolerance" DECIMAL(20,2) NOT NULL,
    "allowOneToMany" BOOLEAN NOT NULL DEFAULT false,
    "allowManyToOne" BOOLEAN NOT NULL DEFAULT false,
    "allowManyToMany" BOOLEAN NOT NULL DEFAULT false,
    "descriptionSimilarityThreshold" DOUBLE PRECISION,
    "materialityThreshold" DECIMAL(20,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "connectorType" TEXT NOT NULL,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatementLayout" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bankCode" TEXT,
    "productType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatementLayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LayoutVersion" (
    "id" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "LayoutStatus" NOT NULL DEFAULT 'DRAFT',
    "formats" TEXT[],
    "detectionRules" JSONB NOT NULL,
    "columnMapping" JSONB NOT NULL,
    "parsingRules" JSONB NOT NULL,
    "fingerprint" JSONB NOT NULL,
    "fingerprintHash" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LayoutVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountLayoutBinding" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "layoutVersionId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "customOverrides" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountLayoutBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "dataSourceId" TEXT,
    "layoutVersionId" TEXT,
    "fileHash" TEXT NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'RECEIVED',
    "duplicateAuthorizationGranted" BOOLEAN NOT NULL DEFAULT false,
    "warnings" JSONB,
    "errors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "validatedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportedFile" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sanitizedName" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportedFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormalizedTransaction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "transactionDate" DATE NOT NULL,
    "postingDate" DATE,
    "amount" DECIMAL(20,2) NOT NULL,
    "nature" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "documentNumber" TEXT,
    "counterpartyDocument" TEXT,
    "balanceAfter" DECIMAL(20,2),
    "source" JSONB NOT NULL,
    "parsing" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NormalizedTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormalizedLedgerEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "transactionDate" DATE NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "nature" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "documentNumber" TEXT,
    "batchNumber" TEXT,
    "source" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NormalizedLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceAType" TEXT NOT NULL,
    "sourceBType" TEXT NOT NULL,

    CONSTRAINT "MatchType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchRule" (
    "id" TEXT NOT NULL,
    "matchTypeId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "cardinality" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "autoConfirm" BOOLEAN NOT NULL DEFAULT false,
    "minimumConfidence" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "MatchRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationPeriod" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'PREPARING',
    "preparerId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "comments" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchGroup" (
    "id" TEXT NOT NULL,
    "reconciliationRunId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "cardinality" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "matchedStatementIds" TEXT[],
    "matchedLedgerIds" TEXT[],
    "dateDifferenceDays" INTEGER,
    "amountDifference" DECIMAL(20,2),
    "descriptionSimilarity" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationException" (
    "id" TEXT NOT NULL,
    "reconciliationRunId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "assignedTo" TEXT,
    "dueDate" TIMESTAMP(3),
    "resolutionCode" TEXT,
    "explanation" TEXT,
    "statementId" TEXT,
    "ledgerId" TEXT,
    "candidateIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionHistory" (
    "id" TEXT NOT NULL,
    "exceptionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "comment" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExceptionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTask" (
    "id" TEXT NOT NULL,
    "reconciliationRunId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assignedTo" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "reconciliationRunId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT,
    "reconciliationRunId" TEXT,
    "matchGroupId" TEXT,
    "exceptionId" TEXT,
    "type" TEXT NOT NULL,
    "source" JSONB NOT NULL,
    "content" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Company_documentNumber_idx" ON "Company"("documentNumber");

-- CreateIndex
CREATE INDEX "CompanyAccess_actorId_idx" ON "CompanyAccess"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyAccess_companyId_actorId_key" ON "CompanyAccess"("companyId", "actorId");

-- CreateIndex
CREATE INDEX "BankAccount_companyId_status_idx" ON "BankAccount"("companyId", "status");

-- CreateIndex
CREATE INDEX "BankAccount_bankCode_agency_accountNumber_idx" ON "BankAccount"("bankCode", "agency", "accountNumber");

-- CreateIndex
CREATE INDEX "LedgerAccount_companyId_status_idx" ON "LedgerAccount"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_companyId_code_key" ON "LedgerAccount"("companyId", "code");

-- CreateIndex
CREATE INDEX "ReconciliationProfile_companyId_status_idx" ON "ReconciliationProfile"("companyId", "status");

-- CreateIndex
CREATE INDEX "ReconciliationProfile_bankAccountId_idx" ON "ReconciliationProfile"("bankAccountId");

-- CreateIndex
CREATE INDEX "DataSource_companyId_status_idx" ON "DataSource"("companyId", "status");

-- CreateIndex
CREATE INDEX "LayoutVersion_fingerprintHash_status_idx" ON "LayoutVersion"("fingerprintHash", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LayoutVersion_layoutId_version_key" ON "LayoutVersion"("layoutId", "version");

-- CreateIndex
CREATE INDEX "AccountLayoutBinding_bankAccountId_status_priority_idx" ON "AccountLayoutBinding"("bankAccountId", "status", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "AccountLayoutBinding_bankAccountId_layoutVersionId_key" ON "AccountLayoutBinding"("bankAccountId", "layoutVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_deduplicationKey_key" ON "ImportBatch"("deduplicationKey");

-- CreateIndex
CREATE INDEX "ImportBatch_companyId_status_createdAt_idx" ON "ImportBatch"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ImportBatch_fileHash_idx" ON "ImportBatch"("fileHash");

-- CreateIndex
CREATE INDEX "ImportedFile_importBatchId_idx" ON "ImportedFile"("importBatchId");

-- CreateIndex
CREATE INDEX "NormalizedTransaction_companyId_accountId_transactionDate_idx" ON "NormalizedTransaction"("companyId", "accountId", "transactionDate");

-- CreateIndex
CREATE INDEX "NormalizedTransaction_importBatchId_idx" ON "NormalizedTransaction"("importBatchId");

-- CreateIndex
CREATE INDEX "NormalizedLedgerEntry_companyId_ledgerAccountId_transaction_idx" ON "NormalizedLedgerEntry"("companyId", "ledgerAccountId", "transactionDate");

-- CreateIndex
CREATE INDEX "NormalizedLedgerEntry_importBatchId_idx" ON "NormalizedLedgerEntry"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchRule_matchTypeId_priority_key" ON "MatchRule"("matchTypeId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationPeriod_companyId_period_key" ON "ReconciliationPeriod"("companyId", "period");

-- CreateIndex
CREATE INDEX "ReconciliationRun_companyId_status_createdAt_idx" ON "ReconciliationRun"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MatchGroup_reconciliationRunId_idx" ON "MatchGroup"("reconciliationRunId");

-- CreateIndex
CREATE INDEX "ReconciliationException_reconciliationRunId_status_idx" ON "ReconciliationException"("reconciliationRunId", "status");

-- CreateIndex
CREATE INDEX "ReconciliationException_assignedTo_status_idx" ON "ReconciliationException"("assignedTo", "status");

-- CreateIndex
CREATE INDEX "ExceptionHistory_exceptionId_occurredAt_idx" ON "ExceptionHistory"("exceptionId", "occurredAt");

-- CreateIndex
CREATE INDEX "WorkflowTask_assignedTo_status_idx" ON "WorkflowTask"("assignedTo", "status");

-- CreateIndex
CREATE INDEX "Approval_reconciliationRunId_occurredAt_idx" ON "Approval"("reconciliationRunId", "occurredAt");

-- CreateIndex
CREATE INDEX "Evidence_importBatchId_idx" ON "Evidence"("importBatchId");

-- CreateIndex
CREATE INDEX "Evidence_reconciliationRunId_idx" ON "Evidence"("reconciliationRunId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_occurredAt_idx" ON "AuditEvent"("entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_companyId_occurredAt_idx" ON "AuditEvent"("companyId", "occurredAt");

-- AddForeignKey
ALTER TABLE "CompanyAccess" ADD CONSTRAINT "CompanyAccess_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationProfile" ADD CONSTRAINT "ReconciliationProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationProfile" ADD CONSTRAINT "ReconciliationProfile_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationProfile" ADD CONSTRAINT "ReconciliationProfile_matchTypeId_fkey" FOREIGN KEY ("matchTypeId") REFERENCES "MatchType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationProfileLedgerAccount" ADD CONSTRAINT "ReconciliationProfileLedgerAccount_reconciliationProfileId_fkey" FOREIGN KEY ("reconciliationProfileId") REFERENCES "ReconciliationProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationProfileLedgerAccount" ADD CONSTRAINT "ReconciliationProfileLedgerAccount_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationPolicy" ADD CONSTRAINT "ReconciliationPolicy_reconciliationProfileId_fkey" FOREIGN KEY ("reconciliationProfileId") REFERENCES "ReconciliationProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayoutVersion" ADD CONSTRAINT "LayoutVersion_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "StatementLayout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountLayoutBinding" ADD CONSTRAINT "AccountLayoutBinding_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountLayoutBinding" ADD CONSTRAINT "AccountLayoutBinding_layoutVersionId_fkey" FOREIGN KEY ("layoutVersionId") REFERENCES "LayoutVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_layoutVersionId_fkey" FOREIGN KEY ("layoutVersionId") REFERENCES "LayoutVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportedFile" ADD CONSTRAINT "ImportedFile_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalizedTransaction" ADD CONSTRAINT "NormalizedTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalizedTransaction" ADD CONSTRAINT "NormalizedTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalizedTransaction" ADD CONSTRAINT "NormalizedTransaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalizedLedgerEntry" ADD CONSTRAINT "NormalizedLedgerEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalizedLedgerEntry" ADD CONSTRAINT "NormalizedLedgerEntry_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalizedLedgerEntry" ADD CONSTRAINT "NormalizedLedgerEntry_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchRule" ADD CONSTRAINT "MatchRule_matchTypeId_fkey" FOREIGN KEY ("matchTypeId") REFERENCES "MatchType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationPeriod" ADD CONSTRAINT "ReconciliationPeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationRun" ADD CONSTRAINT "ReconciliationRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationRun" ADD CONSTRAINT "ReconciliationRun_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ReconciliationProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationRun" ADD CONSTRAINT "ReconciliationRun_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReconciliationPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchGroup" ADD CONSTRAINT "MatchGroup_reconciliationRunId_fkey" FOREIGN KEY ("reconciliationRunId") REFERENCES "ReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationException" ADD CONSTRAINT "ReconciliationException_reconciliationRunId_fkey" FOREIGN KEY ("reconciliationRunId") REFERENCES "ReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionHistory" ADD CONSTRAINT "ExceptionHistory_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "ReconciliationException"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_reconciliationRunId_fkey" FOREIGN KEY ("reconciliationRunId") REFERENCES "ReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_reconciliationRunId_fkey" FOREIGN KEY ("reconciliationRunId") REFERENCES "ReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_reconciliationRunId_fkey" FOREIGN KEY ("reconciliationRunId") REFERENCES "ReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_matchGroupId_fkey" FOREIGN KEY ("matchGroupId") REFERENCES "MatchGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "ReconciliationException"("id") ON DELETE CASCADE ON UPDATE CASCADE;
