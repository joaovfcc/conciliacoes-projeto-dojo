import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const coreRoot = fileURLToPath(new URL("../..", import.meta.url));
const schemaPath = `${coreRoot}/prisma/schema.prisma`;
const initialMigrationPath = `${coreRoot}/prisma/migrations/20260809120000_initial_modular_monolith/migration.sql`;
const configurationMigrationPath = `${coreRoot}/prisma/migrations/20260812120000_multicount_configuration/migration.sql`;

const configurationModels = [
  "ConfigOrganization",
  "ConfigLegalEntity",
  "ConfigBankDirectory",
  "ConfigBank",
  "ConfigBankAccount",
  "ConfigLedgerAccount",
  "ConfigProfile",
  "ConfigProfileVersion",
  "ConfigAccountMapping",
  "ConfigImportMappingVersion",
  "ConfigInheritanceNode",
  "ConfigInheritanceOverride",
  "ConfigSimulation",
  "ConfigWizardDraft",
  "ConfigPublishedSnapshot",
  "ConfigRunRecord",
  "ConfigAuditEvent",
] as const;

describe("configuration Prisma persistence schema", () => {
  it("declares all prefixed administrative entities and tenant keys", async () => {
    const schema = await readFile(schemaPath, "utf8");

    for (const model of configurationModels) {
      expect(schema).toContain(`model ${model} {`);
    }
    const tenantModels = configurationModels.filter((model) => model !== "ConfigOrganization");
    for (const model of tenantModels) {
      const block = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`))?.[1];
      expect(block, `${model} must be tenant-scoped`).toMatch(/organizationId\s+String/);
      expect(block, `${model} must key by tenant and id`).toContain("@@id([organizationId, id])");
    }
  });

  it("indexes bank identity with effective dates and run idempotency per tenant", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain(
      "@@unique([organizationId, legalEntityId, bankId, agency, account, currency, effectiveFrom])",
    );
    expect(schema).toContain(
      "@@index([organizationId, legalEntityId, bankId, agency, account, currency, effectiveFrom, effectiveTo])",
    );
    expect(schema).toContain("@@unique([organizationId, idempotencyKey])");
    expect(schema).toMatch(/fileHashes\s+String\[\]/);
    expect(schema).toContain("@@index([organizationId, configurationHash])");
  });

  it("keeps migrations incremental and free from captured command output", async () => {
    const [initialMigration, configurationMigration] = await Promise.all([
      readFile(initialMigrationPath, "utf8"),
      readFile(configurationMigrationPath, "utf8"),
    ]);

    expect(initialMigration).not.toMatch(/^(Exit code:|Wall time:|Output:)/m);
    expect(configurationMigration).not.toMatch(/^(Exit code:|Wall time:|Output:)/m);
    for (const model of configurationModels) {
      expect(configurationMigration).toContain(`CREATE TABLE "${model}"`);
    }
    expect(configurationMigration).toContain(
      'CREATE UNIQUE INDEX "ConfigRunRecord_organizationId_idempotencyKey_key"',
    );
    expect(configurationMigration).toMatch(/CREATE TABLE "ConfigSimulation"[\s\S]*"approvedAt" TIMESTAMP\(3\)[\s\S]*"approvedBy" TEXT/);
    expect(configurationMigration).toMatch(/CREATE TABLE "ConfigSimulation"[\s\S]*"bankAccountId" TEXT NOT NULL/);
    expect(configurationMigration).toMatch(/CREATE TABLE "ConfigRunRecord"[\s\S]*"snapshotId" TEXT NOT NULL/);
    expect(configurationMigration).toMatch(/CREATE TABLE "ConfigPublishedSnapshot"[\s\S]*"inheritanceNodeId" TEXT/);
    expect(configurationMigration).toMatch(/CREATE TABLE "ConfigPublishedSnapshot"[\s\S]*"requestedEffectiveAt" DATE NOT NULL/);
  });
});
