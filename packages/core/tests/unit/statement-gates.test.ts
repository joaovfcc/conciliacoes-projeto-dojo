import { describe, expect, it } from "vitest";

import { canonicalFromParsedFinancialDocument, runStatementQualityGates } from "../../src/statement-gates.js";
import { createSourceProvenance, type CanonicalStatementDocument } from "../../src/statement-sources.js";
import type { ParsedFinancialDocument } from "../../src/types.js";

const sha256 = "b".repeat(64);

describe("common statement quality gates", () => {
  it("approves a complete current-account document for automatic matching", () => {
    const result = runStatementQualityGates({
      document: currentAccount(),
      sourceSupported: true,
      mappingStatus: "CONFIRMED",
      crosscheckStatus: "NOT_PROVIDED",
    });

    expect(result.decision).toBe("AUTOMATIC");
    expect(result.reconciliationEligible).toBe(true);
    expect(result.gates.every((gate) => gate.status === "PASSED" || gate.status === "NOT_APPLICABLE")).toBe(true);
  });

  it("blocks sign inconsistencies and requires review for duplicate source signatures", () => {
    const invalidSign = currentAccount();
    invalidSign.transactions = [{ ...invalidSign.transactions[0]!, amount: "100.00", direction: "DEBIT" }];
    expect(runStatementQualityGates({
      document: invalidSign,
      sourceSupported: true,
      mappingStatus: "CONFIRMED",
      crosscheckStatus: "NOT_PROVIDED",
    })).toMatchObject({ decision: "BLOCKED" });

    const duplicate = currentAccount();
    duplicate.transactions = [duplicate.transactions[0]!, { ...duplicate.transactions[0]!, transactionId: "tx-2" }];
    duplicate.closingBalance = "800.00";
    const duplicateResult = runStatementQualityGates({
      document: duplicate,
      sourceSupported: true,
      mappingStatus: "CONFIRMED",
      crosscheckStatus: "NOT_PROVIDED",
    });
    expect(duplicateResult.decision).toBe("REVIEW_REQUIRED");
    expect(duplicateResult.gates).toContainEqual(expect.objectContaining({ code: "DUPLICATES", status: "REVIEW_REQUIRED" }));
  });

  it("keeps investments informational and outside current-account matching", () => {
    const investment = { ...currentAccount(), documentType: "INVESTMENT_ACTIVITY" as const };
    const result = runStatementQualityGates({
      document: investment,
      sourceSupported: true,
      mappingStatus: "NOT_REQUIRED",
      crosscheckStatus: "NOT_PROVIDED",
    });

    expect(result.decision).toBe("INFORMATIONAL");
    expect(result.reconciliationEligible).toBe(false);
    expect(result.gates).toContainEqual(expect.objectContaining({ code: "DOCUMENT_TYPE_ELIGIBLE", status: "NOT_APPLICABLE" }));
  });

  it("adapts the current parsed model without retaining raw names or source text", () => {
    const parsed: ParsedFinancialDocument = {
      fileId: "file-1",
      kind: "CURRENT_ACCOUNT",
      identity: { bankName: "ITAU", account: { raw: "123", normalized: "123" } },
      period: { start: "2025-12-01", end: "2025-12-31" },
      movements: [{
        id: "movement-1",
        bankIdentity: { bankName: "ITAU", account: { raw: "123", normalized: "123" } },
        postingDate: "2025-12-01",
        history: "PAGAMENTO",
        amount: "-100.00",
        sourceId: "file-1",
        evidence: {
          fileId: "file-1",
          originalName: "private-account.pdf",
          page: 1,
          sourceText: "private financial text",
          extractionMethod: "TEXT",
          parser: "ITAU_EMPRESAS_CC",
          parserVersion: "1",
        },
      }],
      openingBalance: "1000.00",
      closingBalance: "900.00",
      balanceCheck: {
        status: "PASSED",
        creditTotal: "0.00",
        debitTotal: "-100.00",
        movementTotal: "-100.00",
        tolerance: "0.00",
      },
      suspectedTransactionRows: 1,
      parsedTransactionRows: 1,
      issues: [],
      parserId: "ITAU_EMPRESAS_CC",
      parserVersion: "1",
    };

    const canonical = canonicalFromParsedFinancialDocument(parsed, {
      format: "PDF",
      institutionCode: "341",
      sourceSha256: sha256,
    });

    expect(canonical.transactions[0]?.provenance).toEqual(expect.objectContaining({ rawHash: sha256, page: 1 }));
    expect(JSON.stringify(canonical)).not.toContain("private-account.pdf");
    expect(JSON.stringify(canonical)).not.toContain("private financial text");
  });
});

function currentAccount(): CanonicalStatementDocument {
  return {
    sourceId: "statement-1",
    format: "PDF",
    institutionCode: "341",
    documentType: "CURRENT_ACCOUNT",
    layoutFamily: "ITAU_EMPRESAS_CC",
    adapterId: "ITAU_EMPRESAS_CC",
    adapterVersion: "1",
    identity: {
      bankCode: "341",
      bankName: "ITAU",
      agency: { raw: "1234", normalized: "1234" },
      account: { raw: "56789", normalized: "56789" },
    },
    period: { start: "2025-12-01", end: "2025-12-31" },
    transactions: [{
      transactionId: "tx-1",
      postingDate: "2025-12-10",
      amount: "-100.00",
      direction: "DEBIT",
      description: "PAGAMENTO",
      provenance: createSourceProvenance({
        sourceId: "statement-1",
        format: "PDF",
        adapterId: "ITAU_EMPRESAS_CC",
        adapterVersion: "1",
        rawHash: sha256,
        extractionMethod: "TEXT",
        page: 1,
      }),
    }],
    openingBalance: "1000.00",
    closingBalance: "900.00",
    issues: [],
  };
}
