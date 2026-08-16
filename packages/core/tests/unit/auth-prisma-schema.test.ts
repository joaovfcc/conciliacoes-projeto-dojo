import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const coreRoot = fileURLToPath(new URL("../..", import.meta.url));
const schemaPath = `${coreRoot}/prisma/schema.prisma`;
const migrationPath = `${coreRoot}/prisma/migrations/20260813120000_persistent_authentication/migration.sql`;
const bootstrapPath = `${coreRoot}/scripts/bootstrap-owner.mjs`;
const historyMigrationPath = `${coreRoot}/prisma/migrations/20260813160000_completed_reconciliation_history/migration.sql`;

describe("persistent authentication Prisma schema", () => {
  it("declares users, tenant membership, sessions and one-time refresh tokens", async () => {
    const schema = await readFile(schemaPath, "utf8");

    for (const model of ["User", "OrganizationMembership", "AuthSession", "AuthRefreshToken"]) {
      expect(schema).toContain(`model ${model} {`);
    }
    expect(schema).toContain("email                  String       @unique");
    expect(schema).toContain("passwordChangeRequired Boolean      @default(true)");
    expect(schema).toContain("tokenHash         String    @unique");
    expect(schema).toContain("replacedByTokenId String?   @unique");
  });

  it("makes company access user-backed and scopes operational companies to legal entities", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain("roles     CompanyAccessRole[]");
    expect(schema).toContain("@@unique([companyId, userId])");
    expect(schema).toContain("@@unique([organizationId, legalEntityId])");
    expect(schema).toContain(
      "legalEntity            ConfigLegalEntity @relation(fields: [organizationId, legalEntityId], references: [organizationId, id], onDelete: Restrict)",
    );
  });

  it("migrates incrementally without storing clear credentials", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain('CREATE TABLE "User"');
    expect(migration).toContain('CREATE TABLE "AuthRefreshToken"');
    expect(migration).toContain('FOREIGN KEY ("userId") REFERENCES "User"("id")');
    expect(migration).toContain('CREATE UNIQUE INDEX "AuthRefreshToken_tokenHash_key"');
    expect(migration).not.toMatch(/refreshToken"|password"/);
    expect(migration).not.toMatch(/^(Exit code:|Wall time:|Output:)/m);
  });

  it("bootstraps the first owner atomically and refuses an existing owner", async () => {
    const bootstrap = await readFile(bootstrapPath, "utf8");

    expect(bootstrap).toContain("prisma.$transaction");
    expect(bootstrap).toContain('findFirst({ where: { role: "OWNER" } })');
    expect(bootstrap).toContain("Bootstrap recusado: já existe um OWNER");
    expect(bootstrap).toContain("passwordHash: await hash(password)");
    expect(bootstrap).not.toContain("console.info(password");
  });

  it("retains completed reconciliations with tenant, company, user and expiration constraints", async () => {
    const schema = await readFile(schemaPath, "utf8");
    const migration = await readFile(historyMigrationPath, "utf8");

    expect(schema).toContain("model CompletedReconciliation {");
    expect(schema).toContain("company      Company            @relation(fields: [organizationId, companyId]");
    expect(schema).toContain("@@index([expiresAt])");
    expect(migration).toContain('CREATE TABLE "CompletedReconciliation"');
    expect(migration).toContain('FOREIGN KEY ("organizationId", "companyId") REFERENCES "Company"');
    expect(migration).not.toMatch(/objectKey|BYTEA|tokenHash/);
  });
});
