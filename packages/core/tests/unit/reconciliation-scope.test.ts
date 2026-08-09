import { describe, expect, it } from "vitest";
import {
  InMemoryLedgerRepository,
  InMemoryReconciliationRunRepository,
  InMemoryTransactionRepository,
  ReconcileTransactionsUseCase,
  createNormalizedLedgerEntry,
  createNormalizedTransaction,
  type ReconciliationConfigurationRepository,
  type ReconciliationPeriod,
  type ReconciliationProfile,
} from "../../src/index.js";

describe("BR-01/BR-10 — escopo organizacional do matching", () => {
  it("compara somente conta bancária, contas contábeis e competência do perfil", async () => {
    const transactions = new InMemoryTransactionRepository();
    const ledgers = new InMemoryLedgerRepository();
    const runs = new InMemoryReconciliationRunRepository();
    const profile: ReconciliationProfile = {
      id: "profile-1",
      companyId: "company-1",
      bankAccountId: "bank-account-1",
      ledgerAccountIds: ["ledger-account-1"],
      matchTypeId: "bank-to-ledger",
      frequency: "MONTHLY",
      riskLevel: "LOW",
      amountTolerance: "0.00" as ReconciliationProfile["amountTolerance"],
      dateToleranceDays: 0,
      status: "ACTIVE",
    };
    const period: ReconciliationPeriod = {
      id: "period-1",
      companyId: "company-1",
      period: "2025-12",
      status: "OPEN",
    };
    const configuration: ReconciliationConfigurationRepository = {
      saveProfile: async () => undefined,
      findProfileById: async () => profile,
      listProfilesByCompany: async () => [profile],
      savePolicy: async () => undefined,
      findPolicyByProfileId: async () => null,
      savePeriod: async () => undefined,
      findPeriodById: async () => period,
    };
    const transaction = (id: string, accountId: string, date: string) => createNormalizedTransaction({
      id,
      companyId: "company-1",
      accountId,
      importBatchId: "statement-batch",
      transactionDate: date,
      amount: "100.00",
      nature: "DEBIT",
      description: "PAGAMENTO",
      documentNumber: "DOC-1",
      source: { fileId: "statement-file", rawValues: {} },
      parsing: { layoutId: "layout-1", layoutVersion: 1, confidence: 1, warnings: [] },
    });
    const ledger = (id: string, ledgerAccountId: string, date: string) => createNormalizedLedgerEntry({
      id,
      companyId: "company-1",
      ledgerAccountId,
      importBatchId: "ledger-batch",
      transactionDate: date,
      amount: "100.00",
      nature: "DEBIT",
      description: "PAGAMENTO",
      documentNumber: "DOC-1",
      source: { fileId: "ledger-file", rawValues: {} },
    });
    await transactions.saveAll([
      transaction("statement-valid", "bank-account-1", "2025-12-10"),
      transaction("statement-other-account", "bank-account-2", "2025-12-10"),
      transaction("statement-other-period", "bank-account-1", "2026-01-10"),
    ]);
    await ledgers.saveMany([
      ledger("ledger-valid", "ledger-account-1", "2025-12-10"),
      ledger("ledger-other-account", "ledger-account-2", "2025-12-10"),
      ledger("ledger-other-period", "ledger-account-1", "2026-01-10"),
    ]);

    const result = await new ReconcileTransactionsUseCase(
      transactions,
      ledgers,
      runs,
      undefined,
      undefined,
      configuration,
    ).execute({
      companyId: "company-1",
      profileId: "profile-1",
      periodId: "period-1",
      preparerId: "preparer-1",
    });

    expect(result.matchGroups).toHaveLength(1);
    expect(result.matchGroups[0]).toMatchObject({
      matchedLedgerIds: ["ledger-valid"],
      matchedStatementIds: ["statement-valid"],
      status: "AUTO_CONFIRMED",
    });
    expect(result.exceptions).toHaveLength(0);
  });
});
