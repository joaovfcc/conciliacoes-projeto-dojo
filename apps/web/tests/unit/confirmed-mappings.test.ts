import { describe, expect, it } from "vitest";
import { confirmedMappings } from "../../src/components/reconciliation-app";
import type { PreflightResult } from "@conciliacao/core";

const preflight: PreflightResult = {
  companies: ["EMPRESA"],
  branches: ["01"],
  detectedPeriods: [{ period: "202601", recordCount: 1 }],
  ledgerAccounts: [],
  statements: [
    { fileId: "current", originalName: "conta.pdf", bank: "ITAU", agency: "1", account: "2", periods: ["202601"], recordCount: 1, extractionMethod: "TEXT", parser: "ITAU_CC", classification: "CURRENT_ACCOUNT", reconciliationEligible: true },
    { fileId: "investment", originalName: "investimento.pdf", bank: "ITAU", agency: "1", account: "2", periods: ["202601"], recordCount: 1, extractionMethod: "TEXT", parser: "ITAU_INVEST", classification: "INVESTMENT_ACTIVITY", reconciliationEligible: false },
  ],
  investments: [],
  issues: [],
  requiresUserInput: false,
};

describe("confirmedMappings", () => {
  it("inclui somente extratos elegíveis que foram explicitamente mapeados", () => {
    expect(confirmedMappings(preflight, { current: "11102027", investment: "999" })).toEqual([
      { ledgerAccount: "11102027", statementFileIds: ["current"], signProfile: "BANK_ASSET" },
    ]);
  });
});
