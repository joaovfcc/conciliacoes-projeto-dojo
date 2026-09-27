import { describe, expect, it } from "vitest";
import { confirmedMappings, preferredPreflightPeriod } from "../../src/components/reconciliation-app";
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

  it("usa o perfil de passivo quando o razão reduz o saldo contábil", () => {
    const detected: PreflightResult = {
      ...preflight,
      ledgerAccounts: [{
        account: "11102027", company: "EMPRESA", branch: "01", bank: "ITAU", agency: "0191",
        bankAccount: "26775-6", recordCount: 1, balanceMovementEffect: "SUBTRACTS_FROM_BALANCE",
      }],
    };

    expect(confirmedMappings(detected, { current: "11102027" })[0]?.signProfile).toBe("BANK_LIABILITY");
  });
});

describe("preferredPreflightPeriod", () => {
  it("prefere dezembro do extrato quando o razão possui os doze meses", () => {
    const detected: PreflightResult = {
      ...preflight,
      detectedPeriods: Array.from({ length: 12 }, (_, index) => ({
        period: `2025${String(index + 1).padStart(2, "0")}`,
        recordCount: index === 11 ? 3_800 : 1_000,
      })),
      statements: [{ ...preflight.statements[0]!, periods: ["202512"] }],
    };

    expect(preferredPreflightPeriod(detected)).toBe("202512");
  });

  it("exige escolha explícita quando os extratos abrangem competências diferentes", () => {
    const detected: PreflightResult = {
      ...preflight,
      detectedPeriods: [
        { period: "202511", recordCount: 10 },
        { period: "202512", recordCount: 10 },
      ],
      statements: [
        { ...preflight.statements[0]!, fileId: "novembro", periods: ["202511"] },
        { ...preflight.statements[0]!, fileId: "dezembro", periods: ["202512"] },
      ],
    };

    expect(preferredPreflightPeriod(detected)).toBe("");
  });
});
