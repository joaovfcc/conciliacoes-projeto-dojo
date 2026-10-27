import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { SqliteCompletedReconciliationRepository } from "../../../src/reconciliation/infrastructure/SqliteCompletedReconciliationRepository.js";
import type { CompletedReconciliation } from "../../../src/reconciliation/domain/CompletedReconciliation.js";

describe("SqliteCompletedReconciliationRepository", () => {
  it("salva, lista, consulta por id e remove registros no SQLite em memória", async () => {
    const db = new DatabaseSync(":memory:");
    const repo = new SqliteCompletedReconciliationRepository(db);

    const now = new Date("2026-09-25T10:00:00Z");
    const record: CompletedReconciliation = {
      id: "rec-1",
      organizationId: "org-1",
      companyId: "comp-1",
      userId: "user-1",
      status: "COMPLETED",
      period: "202512",
      confirmation: {
        company: "comp-1",
        period: "202512",
        valueTolerance: "0.01",
        dateToleranceDays: 2,
        mappings: [],
        idempotencyKey: "idem-1",
      },
      sourceFiles: [
        { id: "f1", kind: "LEDGER", originalName: "razao.xlsx" },
        { id: "f2", kind: "STATEMENT", originalName: "extrato.xlsx" },
      ],
      result: {
        period: "202512",
        status: "COMPLETED",
        results: [],
        summary: {
          ledgerCount: 10,
          statementCount: 10,
          matchedCount: 10,
          unmatchedLedgerCount: 0,
          unmatchedStatementCount: 0,
          divergenceCount: 0,
        },
        issues: [],
      } as any,
      completedAt: now,
      expiresAt: new Date(now.getTime() + 86400000),
    };

    const saved = await repo.save(record, "attempt-1", 1);
    expect(saved).toBe(true);

    const list = await repo.list(["comp-1"], 1, 10, now);
    expect(list.total).toBe(1);
    expect(list.items[0]!.id).toBe("rec-1");
    expect(list.items[0]!.period).toBe("202512");

    const found = await repo.findById("rec-1", ["comp-1"], now);
    expect(found).not.toBeNull();
    expect(found?.id).toBe("rec-1");
    expect(found?.sourceFiles).toHaveLength(2);
    expect(found?.result.period).toBe("202512");

    await repo.delete("rec-1");
    const afterDelete = await repo.findById("rec-1", ["comp-1"], now);
    expect(afterDelete).toBeNull();
  });

  it("exclui automaticamente a conciliação mais antiga quando a capacidade máxima é atingida", async () => {
    const db = new DatabaseSync(":memory:");
    const repo = new SqliteCompletedReconciliationRepository(db, 3);
    const baseTime = new Date("2026-09-25T10:00:00Z").getTime();

    for (let i = 1; i <= 4; i++) {
      const completedAt = new Date(baseTime + i * 1000);
      await repo.save({
        id: `rec-${i}`,
        organizationId: "org-1",
        companyId: "comp-1",
        userId: "user-1",
        status: "COMPLETED",
        period: `20260${i}`,
        confirmation: {
          company: "comp-1",
          period: `20260${i}`,
          valueTolerance: "0.01",
          dateToleranceDays: 2,
          mappings: [],
          idempotencyKey: `idem-${i}`,
        },
        sourceFiles: [],
        result: { period: `20260${i}`, status: "COMPLETED", results: [], issues: [] } as any,
        completedAt,
        expiresAt: new Date(completedAt.getTime() + 86400000),
      }, `attempt-${i}`, 1);
    }

    const list = await repo.list(["comp-1"], 1, 10, new Date(baseTime));
    expect(list.total).toBe(3);
    expect(list.items.map((item) => item.id)).toEqual(["rec-4", "rec-3", "rec-2"]);
    expect(await repo.findById("rec-1", ["comp-1"], new Date(baseTime))).toBeNull();
  });
});
