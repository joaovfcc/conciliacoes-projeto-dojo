import { describe, expect, it } from "vitest";
import { InMemoryImportBatchRepository, type ImportBatch } from "../../src/index.js";

function batch(overrides: Partial<ImportBatch> = {}): ImportBatch {
  const now = new Date("2025-12-31T12:00:00Z");
  return {
    id: "batch-1",
    companyId: "company-1",
    bankAccountId: "account-1",
    fileHash: "abc123",
    deduplicationKey: "company-1|account-1|abc123",
    status: "RECEIVED",
    duplicateAuthorizationGranted: false,
    warnings: [],
    errors: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("BR-03 — lote persistente e idempotência", () => {
  it("localiza duplicidade pela empresa, conta e hash", async () => {
    const repository = new InMemoryImportBatchRepository();
    await repository.create(batch());

    const duplicate = await repository.findDuplicate("company-1", "account-1", "abc123");

    expect(duplicate?.id).toBe("batch-1");
  });

  it("não considera o mesmo hash de outra conta como duplicidade", async () => {
    const repository = new InMemoryImportBatchRepository();
    await repository.create(batch());

    expect(await repository.findDuplicate("company-1", "account-2", "abc123")).toBeNull();
  });

  it("registra a progressão de status e os erros", async () => {
    const repository = new InMemoryImportBatchRepository();
    await repository.create(batch());
    await repository.updateStatus("batch-1", "REJECTED", {
      errors: [{ code: "BALANCE_MISMATCH", message: "Saldo não fecha.", severity: "ERROR" }],
    });

    const rejected = await repository.findById("batch-1");
    expect(rejected?.status).toBe("REJECTED");
    expect(rejected?.errors[0]?.code).toBe("BALANCE_MISMATCH");
  });
});
