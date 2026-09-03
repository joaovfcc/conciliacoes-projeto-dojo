import { describe, expect, it } from "vitest";
import type { PreflightResult } from "@conciliacao/core";
import { confirmedIdentityMappings, proposeStatementMappings } from "../../src/components/reconciliation-app";

describe("identidade na confirmação da conciliação", () => {
  it("não relaciona automaticamente bancos incompatíveis mesmo com uma única conta contábil", () => {
    const detected = preflight(
      [{ account: "11102052", company: "EMPRESA", branch: "02", bank: "BRADESCO", agency: "3394", bankAccount: "12545", recordCount: 1 }],
      [{ fileId: "statement", originalName: "extrato.xlsx", bank: "341", agency: "3394", account: "0012545-8", periods: ["202512"], recordCount: 1, extractionMethod: "TABULAR", parser: "itau-checking-xlsx-v1", classification: "CURRENT_ACCOUNT", reconciliationEligible: true }],
    );

    expect(proposeStatementMappings(detected)).toEqual({});
    expect(confirmedIdentityMappings(detected, { statement: "11102052" })).toBe(false);
  });

  it("relaciona conta Bradesco quando o razão omite apenas zeros e dígito", () => {
    const detected = preflight(
      [
        { account: "11102052", company: "EMPRESA", branch: "02", bank: "BRADESCO", agency: "3394", bankAccount: "12545", recordCount: 1 },
        { account: "11102053", company: "EMPRESA", branch: "02", bank: "ITAU", agency: "3394", bankAccount: "12545", recordCount: 1 },
      ],
      [{ fileId: "statement", originalName: "extrato.xlsx", bank: "237", agency: "03394", account: "0012545-8", periods: ["202512"], recordCount: 1, extractionMethod: "TABULAR", parser: "bradesco-checking-xlsx-v1", classification: "CURRENT_ACCOUNT", reconciliationEligible: true }],
    );

    expect(proposeStatementMappings(detected)).toEqual({ statement: "11102052" });
    expect(confirmedIdentityMappings(detected, { statement: "11102052" })).toBe(true);
  });

  it("reutiliza o vínculo cadastrado de uma conta física quando ele aponta para uma única conta do razão", () => {
    const detected = preflight(
      [
        { account: "11102052", company: "EMPRESA", branch: "02", bank: "", agency: "", bankAccount: "", recordCount: 1 },
        { account: "11102053", company: "EMPRESA", branch: "02", bank: "", agency: "", bankAccount: "", recordCount: 1 },
      ],
      [{ fileId: "statement", originalName: "extrato.xlsx", bank: "237", agency: "03394", account: "0012545-8", periods: ["202512"], recordCount: 1, extractionMethod: "TABULAR", parser: "bradesco-checking-xlsx-v1", classification: "CURRENT_ACCOUNT", reconciliationEligible: true }],
    );
    detected.registeredAccountMappings = [
      { bank: "237", agency: "3394", account: "12545-8", ledgerAccount: "11102052" },
    ];

    expect(proposeStatementMappings(detected)).toEqual({ statement: "11102052" });
  });

  it("não escolhe um vínculo cadastrado quando a mesma conta física aponta para contas contábeis conflitantes", () => {
    const detected = preflight(
      [
        { account: "11102052", company: "EMPRESA", branch: "02", bank: "", agency: "", bankAccount: "", recordCount: 1 },
        { account: "11102053", company: "EMPRESA", branch: "02", bank: "", agency: "", bankAccount: "", recordCount: 1 },
      ],
      [{ fileId: "statement", originalName: "extrato.xlsx", bank: "237", agency: "03394", account: "0012545-8", periods: ["202512"], recordCount: 1, extractionMethod: "TABULAR", parser: "bradesco-checking-xlsx-v1", classification: "CURRENT_ACCOUNT", reconciliationEligible: true }],
    );
    detected.registeredAccountMappings = [
      { bank: "237", agency: "3394", account: "12545-8", ledgerAccount: "11102052" },
      { bank: "237", agency: "3394", account: "12545-8", ledgerAccount: "11102053" },
    ];

    expect(proposeStatementMappings(detected)).toEqual({});
  });

  it("exige seleção manual, mas aceita identidade parcial sem divergência", () => {
    const detected = preflight(
      [{ account: "11102052", company: "EMPRESA", branch: "02", bank: "", agency: "", bankAccount: "", recordCount: 1 }],
      [{ fileId: "statement", originalName: "extrato.xlsx", bank: "BANCO NOVO", agency: "1234", account: "98765-0", periods: ["202512"], recordCount: 1, extractionMethod: "TABULAR", parser: "generic-statement-v1", classification: "CURRENT_ACCOUNT", reconciliationEligible: true }],
    );

    expect(proposeStatementMappings(detected)).toEqual({});
    expect(confirmedIdentityMappings(detected, { statement: "11102052" })).toBe(true);
  });
});

function preflight(
  ledgerAccounts: PreflightResult["ledgerAccounts"],
  statements: PreflightResult["statements"],
): PreflightResult {
  return {
    companies: ["EMPRESA"],
    branches: ["02"],
    detectedPeriods: [{ period: "202512", recordCount: 2 }],
    ledgerAccounts,
    statements,
    investments: [],
    issues: [],
    requiresUserInput: false,
  };
}
