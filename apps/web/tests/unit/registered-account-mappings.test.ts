import { describe, expect, it } from "vitest";
import type { ConfirmProcessingRequest, PreflightResult } from "@conciliacao/core";
import { PublicRuntimeError } from "@conciliacao/runtime";
import { enforceRegisteredAccountMappings } from "../../src/lib/registered-account-mappings";

const input: ConfirmProcessingRequest = {
  company: "EMPRESA",
  period: "202512",
  valueTolerance: "0.01",
  dateToleranceDays: 0,
  idempotencyKey: "test-key",
  mappings: [{ ledgerAccount: "11102052", statementFileIds: ["statement"], signProfile: "BANK_ASSET" }],
};

describe("vínculos persistentes de contas", () => {
  it("aceita o vínculo cadastrado correspondente e declara a conta física no escopo lógico", () => {
    const result = enforceRegisteredAccountMappings(preflight(), input, [
      { bank: "237", agency: "3394", account: "12545-8", ledgerAccount: "11102052" },
    ]);

    expect(result.mappings[0]?.linkedPhysicalAccounts).toEqual([
      { statementFileId: "statement", bank: "237", agency: "03394", account: "0012545-8", role: "LINKED" },
    ]);
  });

  it("bloqueia a confirmação quando o cadastro aponta a conta física para outra conta contábil", () => {
    expect(() => enforceRegisteredAccountMappings(preflight(), input, [
      { bank: "237", agency: "3394", account: "12545-8", ledgerAccount: "11102053" },
    ])).toThrow(PublicRuntimeError);
    expect(() => enforceRegisteredAccountMappings(preflight(), input, [
      { bank: "237", agency: "3394", account: "12545-8", ledgerAccount: "11102053" },
    ])).toThrow(/vinculada no cadastro a outra conta contábil/);
  });

  it("bloqueia o cadastro ambíguo antes de permitir a conciliação", () => {
    expect(() => enforceRegisteredAccountMappings(preflight(), input, [
      { bank: "237", agency: "3394", account: "12545-8", ledgerAccount: "11102052" },
      { bank: "237", agency: "3394", account: "12545-8", ledgerAccount: "11102053" },
    ])).toThrow(/vínculos contábeis conflitantes/);
  });
});

function preflight(): PreflightResult {
  return {
    companies: ["EMPRESA"],
    branches: ["02"],
    detectedPeriods: [{ period: "202512", recordCount: 1 }],
    ledgerAccounts: [{ account: "11102052", company: "EMPRESA", branch: "02", bank: "", agency: "", bankAccount: "", recordCount: 1 }],
    statements: [{ fileId: "statement", originalName: "extrato.xlsx", bank: "237", agency: "03394", account: "0012545-8", periods: ["202512"], recordCount: 1, extractionMethod: "TABULAR", parser: "bradesco-checking-xlsx-v1", classification: "CURRENT_ACCOUNT", reconciliationEligible: true }],
    investments: [],
    issues: [],
    requiresUserInput: false,
  };
}
