-- CreateEnum
CREATE TYPE "ConfigProfileVersionStatus" AS ENUM ('DRAFT', 'VALIDATING', 'READY', 'APPROVED', 'PUBLISHED', 'SUPERSEDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ConfigImportMappingSource" AS ENUM ('BANK', 'LEDGER');

-- CreateEnum
CREATE TYPE "ConfigRoutingMatch" AS ENUM ('ALL', 'ANY');

-- CreateEnum
CREATE TYPE "ConfigInheritanceLevel" AS ENUM ('ORGANIZATION', 'LEGAL_ENTITY', 'PROFILE', 'PROFILE_VERSION');

-- CreateEnum
CREATE TYPE "ConfigEffectiveInheritanceLevel" AS ENUM ('GLOBAL', 'BANK_LAYOUT', 'LEGAL_ENTITY', 'PROFILE', 'PROFILE_VERSION');

-- CreateEnum
CREATE TYPE "ConfigSimulationStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ConfigRunMode" AS ENUM ('DRAFT', 'SIMULATION', 'OFFICIAL');

-- CreateEnum
CREATE TYPE "ConfigRunStatus" AS ENUM ('PREPARED', 'PENDING', 'RUNNING', 'SUCCEEDED', 'BLOCKED', 'FAILED', 'TIMED_OUT', 'CANCELLED');

-- CreateTable
CREATE TABLE "ConfigOrganization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "defaultCurrency" TEXT NOT NULL,
    "status" "ActiveStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConfigOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigLegalEntity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "taxId" TEXT NOT NULL,
    "status" "ActiveStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConfigLegalEntity_pkey" PRIMARY KEY ("organizationId", "id")
);

-- CreateTable
CREATE TABLE "ConfigBankDirectory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ActiveStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConfigBankDirectory_pkey" PRIMARY KEY ("organizationId", "id")
);

-- CreateTable
CREATE TABLE "ConfigBank" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "directoryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ActiveStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConfigBank_pkey" PRIMARY KEY ("organizationId", "id")
);

-- CreateTable
CREATE TABLE "ConfigBankAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "agency" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "accountType" "AccountType" NOT NULL,
    "status" "ActiveStatus" NOT NULL,
    "inactivationReason" TEXT,
    "inactivatedAt" TIMESTAMP(3),
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConfigBankAccount_pkey" PRIMARY KEY ("organizationId", "id")
);

-- CreateTable
CREATE TABLE "ConfigLedgerAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "status" "ActiveStatus" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConfigLedgerAccount_pkey" PRIMARY KEY ("organizationId", "id")
);

-- CreateTable
CREATE TABLE "ConfigProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ActiveStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConfigProfile_pkey" PRIMARY KEY ("organizationId", "id")
);

-- CreateTable
CREATE TABLE "ConfigProfileVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ConfigProfileVersionStatus" NOT NULL,
    "configuration" JSONB NOT NULL,
    "sourceVersionId" TEXT,
    "validationIssues" TEXT[],
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    CONSTRAINT "ConfigProfileVersion_pkey" PRIMARY KEY ("organizationId", "id")
);

-- CreateTable
CREATE TABLE "ConfigAccountMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileVersionId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "priority" INTEGER,
    "match" "ConfigRoutingMatch",
    "conditions" JSONB,
    "fallback" BOOLEAN,
    "status" "ActiveStatus" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConfigAccountMapping_pkey" PRIMARY KEY ("organizationId", "id")
);

-- CreateTable
CREATE TABLE "ConfigImportMappingVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileVersionId" TEXT NOT NULL,
    "source" "ConfigImportMappingSource" NOT NULL,
    "version" INTEGER NOT NULL,
    "fieldMap" JSONB NOT NULL,
    "status" "ActiveStatus" NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConfigImportMappingVersion_pkey" PRIMARY KEY ("organizationId", "id")
);

-- CreateTable
CREATE TABLE "ConfigInheritanceNode" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "level" "ConfigInheritanceLevel" NOT NULL,
    "hierarchyLevel" "ConfigEffectiveInheritanceLevel",
    "scopeId" TEXT NOT NULL,
    "parentNodeId" TEXT,
    "sourceVersion" TEXT,
    "values" JSONB NOT NULL,
    "status" "ActiveStatus" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConfigInheritanceNode_pkey" PRIMARY KEY ("organizationId", "id")
);

-- CreateTable
CREATE TABLE "ConfigInheritanceOverride" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    CONSTRAINT "ConfigInheritanceOverride_pkey" PRIMARY KEY ("organizationId", "id")
);

-- CreateTable
CREATE TABLE "ConfigSimulation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileVersionId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "status" "ConfigSimulationStatus" NOT NULL,
    "result" JSONB NOT NULL,
    "reprocessOfSimulationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    CONSTRAINT "ConfigSimulation_pkey" PRIMARY KEY ("organizationId", "id")
);

-- CreateTable
CREATE TABLE "ConfigWizardDraft" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "profileId" TEXT,
    "step" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConfigWizardDraft_pkey" PRIMARY KEY ("organizationId", "id")
);

-- CreateTable
CREATE TABLE "ConfigPublishedSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "profileVersionId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "inheritanceNodeId" TEXT,
    "requestedEffectiveAt" DATE NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "snapshot" JSONB NOT NULL,
    "configurationHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "ConfigPublishedSnapshot_pkey" PRIMARY KEY ("organizationId", "id")
);

-- CreateTable
CREATE TABLE "ConfigRunRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "profileVersionId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "mode" "ConfigRunMode" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "fileHashes" TEXT[],
    "fileNames" TEXT[],
    "configurationHash" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "request" JSONB NOT NULL,
    "result" JSONB,
    "status" "ConfigRunStatus" NOT NULL,
    "reprocessOfRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConfigRunRecord_pkey" PRIMARY KEY ("organizationId", "id")
);

-- CreateTable
CREATE TABLE "ConfigAuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "actor" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    CONSTRAINT "ConfigAuditEvent_pkey" PRIMARY KEY ("organizationId", "id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfigLegalEntity_organizationId_taxId_key" ON "ConfigLegalEntity"("organizationId", "taxId");
CREATE INDEX "ConfigLegalEntity_organizationId_status_idx" ON "ConfigLegalEntity"("organizationId", "status");
CREATE UNIQUE INDEX "ConfigBankDirectory_organizationId_name_key" ON "ConfigBankDirectory"("organizationId", "name");
CREATE INDEX "ConfigBankDirectory_organizationId_status_idx" ON "ConfigBankDirectory"("organizationId", "status");
CREATE UNIQUE INDEX "ConfigBank_organizationId_directoryId_code_key" ON "ConfigBank"("organizationId", "directoryId", "code");
CREATE INDEX "ConfigBank_organizationId_directoryId_status_idx" ON "ConfigBank"("organizationId", "directoryId", "status");
CREATE UNIQUE INDEX "ConfigBankAccount_identity_effectiveFrom_key" ON "ConfigBankAccount"("organizationId", "legalEntityId", "bankId", "agency", "account", "currency", "effectiveFrom");
CREATE INDEX "ConfigBankAccount_identity_effective_idx" ON "ConfigBankAccount"("organizationId", "legalEntityId", "bankId", "agency", "account", "currency", "effectiveFrom", "effectiveTo");
CREATE INDEX "ConfigBankAccount_organizationId_status_idx" ON "ConfigBankAccount"("organizationId", "status");
CREATE UNIQUE INDEX "ConfigLedgerAccount_identity_effectiveFrom_key" ON "ConfigLedgerAccount"("organizationId", "legalEntityId", "sourceSystem", "code", "effectiveFrom");
CREATE INDEX "ConfigLedgerAccount_organizationId_legalEntityId_status_idx" ON "ConfigLedgerAccount"("organizationId", "legalEntityId", "status");
CREATE UNIQUE INDEX "ConfigProfile_organizationId_legalEntityId_name_key" ON "ConfigProfile"("organizationId", "legalEntityId", "name");
CREATE INDEX "ConfigProfile_organizationId_status_idx" ON "ConfigProfile"("organizationId", "status");
CREATE UNIQUE INDEX "ConfigProfileVersion_organizationId_profileId_version_key" ON "ConfigProfileVersion"("organizationId", "profileId", "version");
CREATE INDEX "ConfigProfileVersion_effective_idx" ON "ConfigProfileVersion"("organizationId", "profileId", "status", "effectiveFrom", "effectiveTo");
CREATE UNIQUE INDEX "ConfigAccountMapping_identity_effectiveFrom_key" ON "ConfigAccountMapping"("organizationId", "profileVersionId", "bankAccountId", "ledgerAccountId", "effectiveFrom");
CREATE INDEX "ConfigAccountMapping_organizationId_profileVersionId_status_idx" ON "ConfigAccountMapping"("organizationId", "profileVersionId", "status");
CREATE UNIQUE INDEX "ConfigImportMappingVersion_identity_key" ON "ConfigImportMappingVersion"("organizationId", "profileVersionId", "source", "version");
CREATE INDEX "ConfigImportMappingVersion_profile_status_idx" ON "ConfigImportMappingVersion"("organizationId", "profileVersionId", "status");
CREATE UNIQUE INDEX "ConfigInheritanceNode_scope_effectiveFrom_key" ON "ConfigInheritanceNode"("organizationId", "level", "scopeId", "effectiveFrom");
CREATE INDEX "ConfigInheritanceNode_organizationId_parentNodeId_idx" ON "ConfigInheritanceNode"("organizationId", "parentNodeId");
CREATE INDEX "ConfigInheritanceNode_organizationId_status_idx" ON "ConfigInheritanceNode"("organizationId", "status");
CREATE INDEX "ConfigInheritanceOverride_node_created_idx" ON "ConfigInheritanceOverride"("organizationId", "nodeId", "createdAt");
CREATE INDEX "ConfigSimulation_profile_account_created_idx" ON "ConfigSimulation"("organizationId", "profileVersionId", "bankAccountId", "createdAt");
CREATE INDEX "ConfigSimulation_reprocess_idx" ON "ConfigSimulation"("organizationId", "reprocessOfSimulationId");
CREATE INDEX "ConfigWizardDraft_actor_updated_idx" ON "ConfigWizardDraft"("organizationId", "actorId", "updatedAt");
CREATE INDEX "ConfigWizardDraft_organizationId_profileId_idx" ON "ConfigWizardDraft"("organizationId", "profileId");
CREATE UNIQUE INDEX "ConfigPublishedSnapshot_profile_account_requested_effective_key" ON "ConfigPublishedSnapshot"("organizationId", "profileVersionId", "bankAccountId", "requestedEffectiveAt");
CREATE INDEX "ConfigPublishedSnapshot_effective_idx" ON "ConfigPublishedSnapshot"("organizationId", "profileVersionId", "effectiveFrom", "effectiveTo");
CREATE INDEX "ConfigPublishedSnapshot_configuration_hash_idx" ON "ConfigPublishedSnapshot"("organizationId", "configurationHash");
CREATE UNIQUE INDEX "ConfigRunRecord_organizationId_idempotencyKey_key" ON "ConfigRunRecord"("organizationId", "idempotencyKey");
CREATE INDEX "ConfigRunRecord_configuration_hash_idx" ON "ConfigRunRecord"("organizationId", "configurationHash");
CREATE INDEX "ConfigRunRecord_file_hashes_idx" ON "ConfigRunRecord" USING GIN ("fileHashes");
CREATE INDEX "ConfigRunRecord_profile_created_idx" ON "ConfigRunRecord"("organizationId", "profileVersionId", "createdAt");
CREATE INDEX "ConfigRunRecord_reprocess_idx" ON "ConfigRunRecord"("organizationId", "reprocessOfRunId");
CREATE INDEX "ConfigAuditEvent_entity_at_idx" ON "ConfigAuditEvent"("organizationId", "entityType", "entityId", "at");
CREATE INDEX "ConfigAuditEvent_organizationId_correlationId_idx" ON "ConfigAuditEvent"("organizationId", "correlationId");

-- AddForeignKey
ALTER TABLE "ConfigLegalEntity" ADD CONSTRAINT "ConfigLegalEntity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ConfigOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigBankDirectory" ADD CONSTRAINT "ConfigBankDirectory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ConfigOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigBank" ADD CONSTRAINT "ConfigBank_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ConfigOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigBankAccount" ADD CONSTRAINT "ConfigBankAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ConfigOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigLedgerAccount" ADD CONSTRAINT "ConfigLedgerAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ConfigOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigProfile" ADD CONSTRAINT "ConfigProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ConfigOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigProfileVersion" ADD CONSTRAINT "ConfigProfileVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ConfigOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigAccountMapping" ADD CONSTRAINT "ConfigAccountMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ConfigOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigImportMappingVersion" ADD CONSTRAINT "ConfigImportMappingVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ConfigOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigInheritanceNode" ADD CONSTRAINT "ConfigInheritanceNode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ConfigOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigInheritanceOverride" ADD CONSTRAINT "ConfigInheritanceOverride_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ConfigOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigSimulation" ADD CONSTRAINT "ConfigSimulation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ConfigOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigWizardDraft" ADD CONSTRAINT "ConfigWizardDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ConfigOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigPublishedSnapshot" ADD CONSTRAINT "ConfigPublishedSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ConfigOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigRunRecord" ADD CONSTRAINT "ConfigRunRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ConfigOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigAuditEvent" ADD CONSTRAINT "ConfigAuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ConfigOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
