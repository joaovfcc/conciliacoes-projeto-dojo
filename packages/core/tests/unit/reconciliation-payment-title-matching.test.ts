import { describe, it, expect } from "vitest";
import {
  normalizeDocumentId,
  normalizeDocument,
} from "../../src/normalization.js";
import {
  ReconciliationEngine,
  extractSemanticCategories,
  normalizeReconciliationText,
  reconciliationTextSimilarity,
} from "../../src/reconciliation/domain/ReconciliationEngine.js";
import {
  reconcile,
  traceReconciliationCandidate,
} from "../../src/reconciliation.js";
import type { StatementRecord, LedgerRecord, ConfirmProcessingRequest } from "../../src/types.js";

describe("Reconciliation Payment & Title Matching (PGTO ITAU 64773 vs BAIXA TIT 000064773)", () => {
  describe("1. Document Normalization", () => {
    it("strips leading zeros from numeric document identifiers", () => {
      expect(normalizeDocumentId("000064773")).toBe("64773");
      expect(normalizeDocumentId("64773")).toBe("64773");
      expect(normalizeDocumentId("  000064773  ")).toBe("64773");
      expect(normalizeDocument("000064773")).toBe("64773");
    });

    it("preserves alphanumeric documents while stripping zeros from embedded number sequences", () => {
      expect(normalizeDocumentId("DOC-000064773")).toBe("DOC-64773");
      expect(normalizeDocumentId("64773-A")).toBe("64773-A");
      expect(normalizeDocumentId("0000")).toBe("0");
      expect(normalizeDocumentId("")).toBe("");
    });
  });

  describe("2. Semantic Category Recognition", () => {
    it("extracts PAYMENT_TITLE semantic category from both PGTO and BAIXA TIT aliases", () => {
      expect(extractSemanticCategories("PGTO ITAU 64773 - 25")).toContain("PAYMENT_TITLE");
      expect(extractSemanticCategories("PAGTO FORNECEDOR")).toContain("PAYMENT_TITLE");
      expect(extractSemanticCategories("PAGAMENTO DE DUPLICATA")).toContain("PAYMENT_TITLE");
      expect(extractSemanticCategories("BAIXA TIT. - 000064773 - ITAU UNIBANCO")).toContain("PAYMENT_TITLE");
      expect(extractSemanticCategories("BAIXA DE TITULO")).toContain("PAYMENT_TITLE");
      expect(extractSemanticCategories("LIQUIDACAO TITULO")).toContain("PAYMENT_TITLE");
    });

    it("shares PAYMENT_TITLE and document tokens between statement and ledger descriptions", () => {
      const stmtComparison = [...new Set([...extractSemanticCategories("PGTO ITAU 64773 - 25"), ...normalizeReconciliationText("PGTO ITAU 64773 - 25")])];
      const ldgComparison = [...new Set([...extractSemanticCategories("BAIXA TIT. - 000064773 - ITAU UNIBANCO"), ...normalizeReconciliationText("BAIXA TIT. - 000064773 - ITAU UNIBANCO")])];

      expect(stmtComparison).toContain("PAYMENT_TITLE");
      expect(stmtComparison).toContain("64773");
      expect(ldgComparison).toContain("PAYMENT_TITLE");
      expect(ldgComparison).toContain("64773");

      const similarity = reconciliationTextSimilarity(stmtComparison, ldgComparison);
      expect(similarity).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe("3. End-to-End Pair Reconciliation (Positive Case)", () => {
    const stmtRecord: StatementRecord = {
      id: "stmt-pgto-64773",
      sourceId: "s-64773",
      bank: "341",
      agency: "1234",
      bankAccount: "12345",
      date: "2025-12-30",
      document: "64773",
      history: "PGTO ITAU 64773 - 25",
      value: "-1011.49",
      evidence: { fileId: "stmt-file-1", line: 10, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
    };

    const ldgRecord: LedgerRecord = {
      id: "ldg-baixa-64773",
      sourceId: "l-64773",
      company: "EMPRESA",
      branch: "01",
      ledgerAccount: "11102012",
      date: "2025-12-30",
      document: "000064773",
      history: "BAIXA TIT. - 000064773 - ITAU UNIBANCO",
      value: "-1011.49",
      evidence: { fileId: "ldg-file-1", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
    };

    const confirmation: ConfirmProcessingRequest = {
      company: "EMPRESA",
      branch: "01",
      period: "202512",
      valueTolerance: "0.01",
      dateToleranceDays: 2,
      mappings: [
        {
          ledgerAccount: "11102012",
          statementFileIds: ["stmt-file-1"],
          signProfile: "BANK_LIABILITY",
        },
      ],
      idempotencyKey: "test-payment-title-match-key",
    };

    it("reconciles the pair as AUTO_MATCH_EXACT (RF-02) on same date", () => {
      const result = reconcile([ldgRecord], [stmtRecord], confirmation);
      expect(result.results.length).toBe(1);
      const matched = result.results[0]!;
      expect(matched.status).toBe("AUTO_MATCH_EXACT");
      expect(matched.rule).toBe("RF-02");
      expect(matched.statement?.id).toBe(stmtRecord.id);
      expect(matched.ledger?.id).toBe(ldgRecord.id);
    });

    it("reconciles a unique-value pair when accounting and bank dates differ", () => {
      const ldgDifferentDate: LedgerRecord = {
        ...ldgRecord,
        date: "2025-12-29",
      };
      const result = reconcile([ldgDifferentDate], [stmtRecord], confirmation);
      expect(result.results.length).toBe(1);
      const matched = result.results[0]!;
      expect(matched.status).toBe("AUTO_MATCH_UNIQUE_VALUE");
      expect(matched.rule).toBe("RF-02");
      expect(matched.reason).toBe("O valor em centavos é único no escopo e competência confirmados.");
    });
  });

  describe("4. Negative Tests (Preventing False Positives)", () => {
    const confirmation: ConfirmProcessingRequest = {
      company: "EMPRESA",
      branch: "01",
      period: "202512",
      valueTolerance: "0.01",
      dateToleranceDays: 2,
      mappings: [
        {
          ledgerAccount: "11102012",
          statementFileIds: ["stmt-file-1"],
          signProfile: "BANK_LIABILITY",
        },
      ],
      idempotencyKey: "test-negative-key",
    };

    it("does not reject a unique-value pair only because its dates differ", () => {
      const stmt: StatementRecord = {
        id: "s-out-date",
        sourceId: "s-out-date",
        bank: "341",
        agency: "1234",
        bankAccount: "12345",
        date: "2025-12-30",
        document: "64773",
        history: "PGTO ITAU 64773 - 25",
        value: "-1011.49",
        evidence: { fileId: "stmt-file-1", line: 10, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };
      const ldg: LedgerRecord = {
        id: "l-out-date",
        sourceId: "l-out-date",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2025-12-20", // 10 days before
        document: "000064773",
        history: "BAIXA TIT. - 000064773 - ITAU UNIBANCO",
        value: "-1011.49",
        evidence: { fileId: "ldg-file-1", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const result = reconcile([ldg], [stmt], confirmation);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        status: "AUTO_MATCH_UNIQUE_VALUE",
        rule: "RF-02",
        statement: { id: "s-out-date" },
        ledger: { id: "l-out-date" },
      });
    });

    it("does NOT match when amounts diverge", () => {
      const stmt: StatementRecord = {
        id: "s-diff-amt",
        sourceId: "s-diff-amt",
        bank: "341",
        agency: "1234",
        bankAccount: "12345",
        date: "2025-12-30",
        document: "64773",
        history: "PGTO ITAU 64773 - 25",
        value: "-1011.49",
        evidence: { fileId: "stmt-file-1", line: 10, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };
      const ldg: LedgerRecord = {
        id: "l-diff-amt",
        sourceId: "l-diff-amt",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2025-12-30",
        document: "000064773",
        history: "BAIXA TIT. - 000064773 - ITAU UNIBANCO",
        value: "-1012.00",
        evidence: { fileId: "ldg-file-1", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const result = reconcile([ldg], [stmt], confirmation);
      expect(result.results.length).toBe(2);
      expect(result.results.some((r) => r.status === "STATEMENT_WITHOUT_LEDGER")).toBe(true);
      expect(result.results.some((r) => r.status === "LEDGER_WITHOUT_STATEMENT")).toBe(true);
    });
  });

  describe("5. Candidate Diagnostic Trace Tool", () => {
    it("generates structured diagnostic for candidate pair matching", () => {
      const stmt: StatementRecord = {
        id: "stmt-trace-1",
        sourceId: "s1",
        bank: "341",
        agency: "1234",
        bankAccount: "12345",
        date: "2025-12-30",
        document: "64773",
        history: "PGTO ITAU 64773 - 25",
        value: "-1011.49",
        evidence: { fileId: "stmt-file-1", line: 10, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };
      const ldg: LedgerRecord = {
        id: "ldg-trace-1",
        sourceId: "l1",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2025-12-30",
        document: "000064773",
        history: "BAIXA TIT. - 000064773 - ITAU UNIBANCO",
        value: "-1011.49",
        evidence: { fileId: "ldg-file-1", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const diag = traceReconciliationCandidate({
        statementRecord: stmt,
        ledgerRecord: ldg,
        signProfile: "BANK_LIABILITY",
        dateToleranceDays: 2,
      });

      expect(diag.statement).toBeDefined();
      expect(diag.statement?.normalizedDocument).toBe("64773");
      expect(diag.statement?.category).toBe("PAYMENT_TITLE");
      expect(diag.statement?.sign).toBe("negative");

      expect(diag.ledger).toBeDefined();
      expect(diag.ledger?.normalizedDocument).toBe("64773");
      expect(diag.ledger?.category).toBe("PAYMENT_TITLE");
      expect(diag.ledger?.sign).toBe("negative");

      expect(diag.candidateComparison.sameDate).toBe(true);
      expect(diag.candidateComparison.sameAmount).toBe(true);
      expect(diag.candidateComparison.documentCompatible).toBe(true);
      expect(diag.candidateComparison.semanticCategoryCompatible).toBe(true);
      expect(diag.candidateComparison.wasCandidateGenerated).toBe(true);
      expect(diag.candidateComparison.finalDecision).toBe("MATCHED");
    });
  });
});
