import { describe, expect, it } from "vitest";
import { InMemoryCompletedReconciliationRepository } from "../../packages/core/src/index";
import type { ConfirmProcessingRequest, LedgerRecord, PreflightResult, StatementRecord } from "../../packages/core/src/types";
import { loadRuntimeConfig } from "../../packages/runtime/src/config";
import { LocalObjectStore } from "../../packages/runtime/src/object-store";
import { MemorySessionStore } from "../../packages/runtime/src/session-store";
import { RuntimeServices } from "../../packages/runtime/src/services";
import type { ReconciliationSession } from "../../packages/runtime/src/types";

const ledger: LedgerRecord = {
  id: "ledger-1",
  company: "",
  branch: "01",
  ledgerAccount: "11102027",
  date: "2025-12-01",
  document: "",
  history: "BAIXA TITULO",
  value: "-337.70",
  sourceId: "ledger-source",
  evidence: { fileId: "ledger-file", originalName: "razao.xlsx", extractionMethod: "TABULAR", line: 10 },
};

const statement: StatementRecord = {
  id: "statement-1",
  bank: "ITAU",
  agency: "8363",
  bankAccount: "00378-4",
  date: "2025-12-01",
  document: "9773",
  history: "SISPAG FORNECEDORES",
  value: "-337.70",
  sourceId: "statement-source",
  evidence: { fileId: "statement-file", originalName: "itau 00378-4.pdf", extractionMethod: "OCR", page: 1 },
};

const preflight: PreflightResult = {
  companies: [],
  branches: ["01"],
  detectedPeriods: [{ period: "202512", recordCount: 2 }],
  ledgerAccounts: [{ account: "11102027", company: "", branch: "01", bank: "ITAU", agency: "0191", bankAccount: "26775-6", recordCount: 1 }],
  statements: [{ fileId: "statement-file", originalName: "itau 00378-4.pdf", bank: "ITAU", agency: "8363", account: "00378-4", periods: ["202512"], recordCount: 1, extractionMethod: "OCR", parser: "ITAU_EMPRESAS_WEB_V1", classification: "CURRENT_ACCOUNT", reconciliationEligible: true }],
  investments: [],
  issues: [],
  requiresUserInput: false,
};

const confirmation: ConfirmProcessingRequest = {
  company: "SPREAD",
  branch: "01",
  period: "202512",
  valueTolerance: "0.01",
  dateToleranceDays: 2,
  mappings: [{ ledgerAccount: "11102027", statementFileIds: ["statement-file"], signProfile: "BANK_ASSET" }],
  idempotencyKey: "integration-account-conflict",
};

describe("mapeamento de conta bancária", () => {
  it("bloqueia a conciliação quando o extrato pertence a uma conta incompatível", async () => {
    const config = { ...loadRuntimeConfig({}), localStoragePath: ".test-storage" };
    const runtime = new RuntimeServices(config, new MemorySessionStore(config), new LocalObjectStore(config), new InMemoryCompletedReconciliationRepository());
    const session: ReconciliationSession = {
      id: "session-1",
      tokenHash: "hash",
      clientKey: "client",
      actorId: "user",
      organizationId: "org",
      companyId: "company",
      createdAt: "2026-08-02T00:00:00.000Z",
      expiresAt: "2026-08-02T02:00:00.000Z",
      lastHeartbeatAt: "2026-08-02T00:00:00.000Z",
      status: "AWAITING_CONFIRMATION",
      progress: 35,
      progressMessage: "Pré-análise concluída.",
      files: [
        { id: "ledger-file", kind: "LEDGER", originalName: "razao.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 1, objectKey: "ledger" },
        { id: "statement-file", kind: "STATEMENT", originalName: "itau 00378-4.pdf", contentType: "application/pdf", size: 1, objectKey: "statement" },
      ],
      preflight,
      ledgers: [ledger],
      statements: [statement],
      closed: false,
    };

    await expect(runtime.process(session, confirmation)).rejects.toMatchObject({
      code: "BANK_ACCOUNT_MISMATCH",
    });
    expect(session.result).toBeUndefined();
  });
});
