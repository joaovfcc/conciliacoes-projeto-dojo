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

  it("blocks a statement whose identity conflicts with the selected bank account", () => {
    const result = runStatementQualityGates({
      document: currentAccount(),
      sourceSupported: true,
      mappingStatus: "CONFIRMED",
      crosscheckStatus: "NOT_PROVIDED",
      expectedIdentity: { bankCode: "341", agency: "01234", account: "99999" },
    });

    expect(result.decision).toBe("BLOCKED");
    expect(result.gates).toContainEqual(expect.objectContaining({
      code: "IDENTITY",
      status: "FAILED",
      issueCodes: ["BANK_ACCOUNT_IDENTITY_MISMATCH"],
    }));
  });

  it("registra aprovação e falha da validação cruzada estruturada", () => {
    const evaluate = (crosscheckStatus: "PASSED" | "FAILED") => runStatementQualityGates({
      document: currentAccount(),
      sourceSupported: true,
      mappingStatus: "CONFIRMED",
      crosscheckStatus,
    });

    expect(evaluate("PASSED").gates).toContainEqual(expect.objectContaining({ code: "CROSSCHECK", status: "PASSED" }));
    expect(evaluate("FAILED")).toMatchObject({ decision: "BLOCKED" });
  });

  it("bloqueia períodos inválidos e movimentos fora da competência", () => {
    const invalidCalendar = currentAccount();
    invalidCalendar.period = { start: "2025-02-30", end: "2025-12-31" };
    const reversed = currentAccount();
    reversed.period = { start: "2025-12-31", end: "2025-12-01" };
    const outside = currentAccount();
    outside.transactions = [{ ...outside.transactions[0]!, postingDate: "2026-01-01" }];
    const evaluate = (document: CanonicalStatementDocument) => runStatementQualityGates({
      document,
      sourceSupported: true,
      mappingStatus: "CONFIRMED",
      crosscheckStatus: "NOT_PROVIDED",
    });

    expect(evaluate(invalidCalendar).gates).toContainEqual(expect.objectContaining({ code: "PERIOD", status: "FAILED" }));
    expect(evaluate(reversed).decision).toBe("BLOCKED");
    expect(evaluate(outside).gates).toContainEqual(expect.objectContaining({ issueCodes: ["TRANSACTION_OUTSIDE_STATEMENT_PERIOD"] }));
  });

  it("diferencia revisão de identidade, período, saldo e mapeamento ausentes", () => {
    const withoutIdentity = currentAccount();
    withoutIdentity.identity = { bankName: "ITAU" };
    delete withoutIdentity.period;
    delete withoutIdentity.openingBalance;
    delete withoutIdentity.closingBalance;
    const result = runStatementQualityGates({
      document: withoutIdentity,
      sourceSupported: true,
      mappingStatus: "PENDING",
      crosscheckStatus: "NOT_PROVIDED",
    });

    expect(result.decision).toBe("REVIEW_REQUIRED");
    expect(result.gates.filter((gate) => gate.status === "REVIEW_REQUIRED").map((gate) => gate.code)).toEqual([
      "IDENTITY",
      "PERIOD",
      "BALANCE",
      "MAPPING",
    ]);
  });

  it("bloqueia erro estrutural, valor inválido, saldo divergente e mapeamento ausente", () => {
    const structural = currentAccount();
    structural.issues = [{ severity: "ERROR", code: "BROKEN_LAYOUT", message: "Layout incompleto" }];
    const invalidAmount = currentAccount();
    invalidAmount.transactions = [{ ...invalidAmount.transactions[0]!, amount: "invalid" }];
    const balanceMismatch = currentAccount();
    balanceMismatch.closingBalance = "901.00";
    const base = {
      sourceSupported: true,
      mappingStatus: "CONFIRMED" as const,
      crosscheckStatus: "NOT_PROVIDED" as const,
    };

    expect(runStatementQualityGates({ document: structural, ...base }).decision).toBe("BLOCKED");
    expect(runStatementQualityGates({ document: invalidAmount, ...base }).gates).toContainEqual(
      expect.objectContaining({ code: "SIGNS", status: "FAILED" }),
    );
    expect(runStatementQualityGates({ document: balanceMismatch, ...base }).gates).toContainEqual(
      expect.objectContaining({ code: "BALANCE", issueCodes: ["BALANCE_INTEGRITY_FAILED"] }),
    );
    expect(runStatementQualityGates({
      document: currentAccount(),
      sourceSupported: true,
      mappingStatus: "NOT_REQUIRED",
      crosscheckStatus: "NOT_PROVIDED",
    }).decision).toBe("BLOCKED");
  });

  it("bloqueia documento ausente e converte métodos canônicos para todos os formatos", () => {
    expect(runStatementQualityGates({
      sourceSupported: true,
      mappingStatus: "CONFIRMED",
      crosscheckStatus: "NOT_PROVIDED",
    })).toMatchObject({ decision: "BLOCKED", reconciliationEligible: false });

    const cases = [
      ["CSV", "TEXT", "CSV"],
      ["OFX", "TEXT", "OFX"],
      ["XLSX", "TEXT", "TABULAR"],
      ["XLS", "TEXT", "TABULAR"],
      ["XLSM", "TEXT", "TABULAR"],
      ["PDF", "OCR", "OCR"],
      ["PDF", "MIXED", "MIXED"],
      ["PDF", "TEXT", "TEXT"],
    ] as const;
    for (const [format, extractionMethod, expected] of cases) {
      const canonical = canonicalFromParsedFinancialDocument(parsedDocument(extractionMethod), {
        format,
        institutionCode: "341",
        sourceSha256: sha256,
      });
      expect(canonical.transactions[0]?.provenance.extractionMethod).toBe(expected);
    }
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

function parsedDocument(extractionMethod: "TEXT" | "OCR" | "MIXED"): ParsedFinancialDocument {
  return {
    fileId: "file-canonical",
    kind: "CURRENT_ACCOUNT",
    identity: {
      bankName: "ITAU",
      agency: { raw: "1234", normalized: "1234" },
      account: { raw: "56789", normalized: "56789" },
    },
    period: { start: "2025-12-01", end: "2025-12-31" },
    movements: [{
      id: "movement-canonical",
      bankIdentity: { bankName: "ITAU" },
      postingDate: "2025-12-10",
      history: "PAGAMENTO",
      amount: "-100.00",
      document: " DOC-1 ",
      evidence: {
        fileId: "file-canonical",
        originalName: "private.pdf",
        extractionMethod,
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
      tolerance: "0.01",
    },
    suspectedTransactionRows: 1,
    parsedTransactionRows: 1,
    issues: [],
    parserId: "ITAU_EMPRESAS_CC",
    parserVersion: "1",
  };
}
