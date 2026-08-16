import { describe, expect, it } from "vitest";
import { InMemoryCompletedReconciliationRepository } from "../../packages/core/src/index";
import type { ConfirmProcessingRequest, LedgerRecord, PreflightResult, StatementRecord } from "../../packages/core/src/types";
import { loadRuntimeConfig } from "../../packages/runtime/src/config";
import { LocalObjectStore } from "../../packages/runtime/src/object-store";
import { MemorySessionStore } from "../../packages/runtime/src/session-store";
import { RuntimeServices } from "../../packages/runtime/src/services";
import type { ReconciliationSession } from "../../packages/runtime/src/types";

const ledger: LedgerRecord = {
  id: "l", company: "EMPRESA", branch: "01", ledgerAccount: "111", date: "2026-01-02", document: "1", history: "PAGAMENTO", value: "10.00", sourceId: "l",
  evidence: { fileId: "ledger", originalName: "razao.xlsx", extractionMethod: "TABULAR", line: 2 },
};
const statement: StatementRecord = {
  id: "s", bank: "ITAU", agency: "9999", bankAccount: "00001-1", date: "2026-01-02", document: "1", history: "PAGAMENTO", value: "10.00", sourceId: "s",
  evidence: { fileId: "statement", originalName: "extrato.pdf", extractionMethod: "TEXT", page: 1 },
};
const preflight: PreflightResult = {
  companies: ["EMPRESA"], branches: ["01"], detectedPeriods: [{ period: "202601", recordCount: 2 }],
  ledgerAccounts: [{ account: "111", company: "EMPRESA", branch: "01", bank: "341", agency: "0191", bankAccount: "26775-6", recordCount: 1 }],
  statements: [{ fileId: "statement", originalName: "extrato.pdf", bank: "ITAU", agency: "9999", account: "00001-1", periods: ["202601"], recordCount: 1, extractionMethod: "TEXT", parser: "ITAU_CC", classification: "CURRENT_ACCOUNT", reconciliationEligible: true }],
  investments: [], issues: [], requiresUserInput: false,
};
const confirmation: ConfirmProcessingRequest = {
  company: "EMPRESA", branch: "01", period: "202601", valueTolerance: "0.01", dateToleranceDays: 2,
  mappings: [{ ledgerAccount: "111", statementFileIds: ["statement"], signProfile: "BANK_ASSET" }], idempotencyKey: "mapping-gate",
};

describe("gate de conta bancária", () => {
  it("não deixa conta incompatível alcançar o reconciliador", async () => {
    const config = { ...loadRuntimeConfig({}), localStoragePath: ".test-storage" };
    const runtime = new RuntimeServices(config, new MemorySessionStore(config), new LocalObjectStore(config), new InMemoryCompletedReconciliationRepository());
    const session: ReconciliationSession = {
      id: "session", tokenHash: "hash", clientKey: "client", actorId: "user", organizationId: "org", companyId: "company", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T02:00:00.000Z", lastHeartbeatAt: "2026-01-01T00:00:00.000Z",
      status: "AWAITING_CONFIRMATION", progress: 35, progressMessage: "ok", files: [], preflight, ledgers: [ledger], statements: [statement], closed: false,
    };

    await expect(runtime.process(session, confirmation)).rejects.toMatchObject({ code: "BANK_ACCOUNT_MISMATCH" });
    expect(session.result).toBeUndefined();
  });

  it("não deixa extrato com controle de saldo falho alcançar o reconciliador", async () => {
    const config = { ...loadRuntimeConfig({}), localStoragePath: ".test-storage" };
    const runtime = new RuntimeServices(config, new MemorySessionStore(config), new LocalObjectStore(config), new InMemoryCompletedReconciliationRepository());
    const balancedStatement = { ...statement, agency: "0191", bankAccount: "26775-6" };
    const preflightWithBalanceFailure: PreflightResult = {
      ...preflight,
      statements: [{ ...preflight.statements[0]!, agency: "0191", account: "26775-6", balanceCheck: { status: "FAILED", creditTotal: "10.00", debitTotal: "0.00", movementTotal: "10.00", tolerance: "0.01", difference: "1.00" } }],
    };
    const session: ReconciliationSession = {
      id: "session-balance", tokenHash: "hash", clientKey: "client", actorId: "user", organizationId: "org", companyId: "company", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T02:00:00.000Z", lastHeartbeatAt: "2026-01-01T00:00:00.000Z",
      status: "AWAITING_CONFIRMATION", progress: 35, progressMessage: "ok", files: [], preflight: preflightWithBalanceFailure, ledgers: [ledger], statements: [balancedStatement], closed: false,
    };

    await expect(runtime.process(session, confirmation)).rejects.toMatchObject({ code: "BALANCE_INTEGRITY_FAILED" });
    expect(session.result).toBeUndefined();
  });
});
