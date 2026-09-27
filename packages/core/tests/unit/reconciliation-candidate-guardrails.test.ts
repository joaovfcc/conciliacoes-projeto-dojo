import { describe, it, expect } from "vitest";
import {
  normalizeDocumentId,
  normalizeDocument,
} from "../../src/normalization.js";
import {
  extractBankHint,
  extractSemanticCategories,
  extractFinancialHint,
  calculateCandidateScore,
  normalizeReconciliationText,
  reconciliationTextSimilarity,
} from "../../src/reconciliation/domain/ReconciliationEngine.js";
import {
  reconcile,
  traceReconciliationCandidate,
} from "../../src/reconciliation.js";
import type { StatementRecord, LedgerRecord, ConfirmProcessingRequest } from "../../src/types.js";

describe("Reconciliation Candidate Guardrails & Score System", () => {
  describe("1. Bank Hint Preservation (Guardrail 1)", () => {
    it("1. preserves ITAU as bankHint in 'PGTO ITAU 64773 - 25'", () => {
      const hint = extractBankHint("PGTO ITAU 64773 - 25");
      expect(hint).toBe("ITAU");
    });

    it("2. preserves ITAU as bankHint in 'BAIXA TIT. - 000064773 - ITAU UNIBANCO'", () => {
      const hint = extractBankHint("BAIXA TIT. - 000064773 - ITAU UNIBANCO");
      expect(hint).toBe("ITAU");
    });

    it("3. includes PAYMENT_TITLE, ITAU, and 64773 in comparisonTokens", () => {
      const stmtHint = extractFinancialHint("PGTO ITAU 64773 - 25", "64773");
      expect(stmtHint.bankHint).toBe("ITAU");
      expect(stmtHint.semanticCategory).toBe("PAYMENT_TITLE");
      expect(stmtHint.comparisonTokens).toContain("PAYMENT_TITLE");
      expect(stmtHint.comparisonTokens).toContain("ITAU");
      expect(stmtHint.comparisonTokens).toContain("64773");

      const ldgHint = extractFinancialHint("BAIXA TIT. - 000064773 - ITAU UNIBANCO", "64773");
      expect(ldgHint.bankHint).toBe("ITAU");
      expect(ldgHint.semanticCategory).toBe("PAYMENT_TITLE");
      expect(ldgHint.comparisonTokens).toContain("PAYMENT_TITLE");
      expect(ldgHint.comparisonTokens).toContain("ITAU");
      expect(ldgHint.comparisonTokens).toContain("64773");
      expect(ldgHint.comparisonTokens).toContain("UNIBANCO");

      const similarity = reconciliationTextSimilarity(stmtHint.comparisonTokens, ldgHint.comparisonTokens);
      expect(similarity).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe("2. Safe Document Normalization (Guardrail 2)", () => {
    it("4. normalizeDocumentId('000064773') returns '64773'", () => {
      expect(normalizeDocumentId("000064773")).toBe("64773");
    });

    it("5. normalizeDocumentId('DOC-000064773') returns 'DOC-64773'", () => {
      expect(normalizeDocumentId("DOC-000064773")).toBe("DOC-64773");
      expect(normalizeDocumentId("NF 000123")).toBe("NF 123");
    });

    it("6. normalizeDocumentId('64773-A') preserves '64773-A'", () => {
      expect(normalizeDocumentId("64773-A")).toBe("64773-A");
      expect(normalizeDocumentId("000064773-A")).toBe("64773-A");
    });

    it("7. normalizeDocumentId('ABC000123') preserves 'ABC000123' without stripping zeros glued to letters", () => {
      expect(normalizeDocumentId("ABC000123")).toBe("ABC000123");
    });

    it("8. normalizeDocumentId('001-002') preserves '001-002'", () => {
      expect(normalizeDocumentId("001-002")).toBe("001-002");
    });
  });

  describe("3. Matching and Negative Guardrails (Guardrails 3, 4 & 5)", () => {
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
      idempotencyKey: "test-guardrail-key",
    };

    it("9. PGTO ITAU 64773 reconciles with BAIXA TIT. 000064773", () => {
      const stmt: StatementRecord = {
        id: "s-64773",
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
      const ldg: LedgerRecord = {
        id: "l-64773",
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

      const result = reconcile([ldg], [stmt], confirmation);
      expect(result.results.length).toBe(1);
      expect(result.results[0]!.status).toBe("AUTO_MATCH_EXACT");
      expect(result.results[0]!.rule).toBe("RF-02");
    });

    it("10. PGTO ITAU 64773 does NOT match BAIXA TIT. 000064774 (divergent document)", () => {
      const stmt: StatementRecord = {
        id: "s-64773",
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
      const ldgDivergent: LedgerRecord = {
        id: "l-64774",
        sourceId: "l-64774",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2025-12-30",
        document: "000064774",
        history: "BAIXA TIT. - 000064774 - ITAU UNIBANCO",
        value: "-1011.49",
        evidence: { fileId: "ldg-file-1", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const result = reconcile([ldgDivergent], [stmt], confirmation);
      expect(result.results.length).toBe(2);
      expect(result.results.some((r) => r.status === "STATEMENT_WITHOUT_LEDGER")).toBe(true);
      expect(result.results.some((r) => r.status === "LEDGER_WITHOUT_STATEMENT")).toBe(true);
    });

    it("11. with two candidates of same amount/date, correct document wins (64773 over 64774)", () => {
      const stmt: StatementRecord = {
        id: "s-target",
        sourceId: "s-target",
        bank: "341",
        agency: "1234",
        bankAccount: "12345",
        date: "2025-12-30",
        document: "64773",
        history: "PGTO ITAU 64773 - 25",
        value: "-1011.49",
        evidence: { fileId: "stmt-file-1", line: 10, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };
      const ldgCorrect: LedgerRecord = {
        id: "l-correct",
        sourceId: "l-correct",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2025-12-30",
        document: "000064773",
        history: "BAIXA TIT. - 000064773 - ITAU UNIBANCO",
        value: "-1011.49",
        evidence: { fileId: "ldg-file-1", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };
      const ldgOther: LedgerRecord = {
        id: "l-other",
        sourceId: "l-other",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2025-12-30",
        document: "000064774",
        history: "BAIXA TIT. - 000064774 - ITAU UNIBANCO",
        value: "-1011.49",
        evidence: { fileId: "ldg-file-1", line: 21, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const result = reconcile([ldgCorrect, ldgOther], [stmt], confirmation);
      const match = result.results.find((r) => r.status.startsWith("AUTO_MATCH"));
      expect(match).toBeDefined();
      expect(match?.ledger?.id).toBe("l-correct");
      expect(result.results.some((r) => r.ledger?.id === "l-other" && r.status === "LEDGER_WITHOUT_STATEMENT")).toBe(true);
    });

    it("12. with two indistinguishable candidates without document, diagnostic marks ambiguous", () => {
      const stmt: StatementRecord = {
        id: "s-amb",
        sourceId: "s-amb",
        bank: "341",
        agency: "1234",
        bankAccount: "12345",
        date: "2025-12-30",
        document: "",
        history: "PGTO ITAU",
        value: "-1011.49",
        evidence: { fileId: "stmt-file-1", line: 10, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };
      const ldg1: LedgerRecord = {
        id: "l-amb-1",
        sourceId: "l-amb-1",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2025-12-30",
        document: "",
        history: "BAIXA TIT. ITAU UNIBANCO",
        value: "-1011.49",
        evidence: { fileId: "ldg-file-1", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };
      const ldg2: LedgerRecord = {
        id: "l-amb-2",
        sourceId: "l-amb-2",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2025-12-30",
        document: "",
        history: "BAIXA TIT. ITAU UNIBANCO",
        value: "-1011.49",
        evidence: { fileId: "ldg-file-1", line: 21, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const diag = traceReconciliationCandidate({
        statementRecord: stmt,
        ledgerRecord: ldg1,
        competingLedgers: [ldg2],
        signProfile: "BANK_LIABILITY",
      });

      expect(diag.candidateComparison.finalDecision).toBe("AMBIGUOUS");
      expect(diag.candidateComparison.rejectedByRule).toBe("AMBIGUITY");
      expect(diag.candidateComparison.score?.ambiguityPenalty).toBe(-50);
    });

    it("13. category PAYMENT_TITLE alone does not allow match without date/amount/document evidence", () => {
      const score = calculateCandidateScore({
        statementDate: "2025-12-30",
        ledgerDate: "2025-12-10", // 20 days off
        statementAmountCents: -101149n,
        ledgerAmountCents: -200000n, // different amount
        statementDescription: "PGTO FORNECEDOR",
        ledgerHistory: "BAIXA TITULO",
      });
      expect(score.semanticCategory).toBe(20);
      expect(score.decision).toBe("REJECT");
    });

    it("14. compatible bank increases score (+10)", () => {
      const scoreWithBank = calculateCandidateScore({
        statementDate: "2025-12-30",
        ledgerDate: "2025-12-30",
        statementAmountCents: -101149n,
        ledgerAmountCents: -101149n,
        statementDescription: "PGTO ITAU 64773",
        ledgerHistory: "BAIXA TIT. 000064773 ITAU",
        statementDocument: "64773",
        ledgerDocument: "000064773",
      });

      const scoreWithoutBank = calculateCandidateScore({
        statementDate: "2025-12-30",
        ledgerDate: "2025-12-30",
        statementAmountCents: -101149n,
        ledgerAmountCents: -101149n,
        statementDescription: "PGTO FORNECEDOR 64773",
        ledgerHistory: "BAIXA TIT. 000064773",
        statementDocument: "64773",
        ledgerDocument: "000064773",
      });

      expect(scoreWithBank.bankHint).toBe(10);
      expect(scoreWithoutBank.bankHint).toBe(0);
      expect(scoreWithBank.total).toBeGreaterThan(scoreWithoutBank.total);
    });

    it("15. divergent bank reduces score (-20)", () => {
      const scoreDivergent = calculateCandidateScore({
        statementDate: "2025-12-30",
        ledgerDate: "2025-12-30",
        statementAmountCents: -101149n,
        ledgerAmountCents: -101149n,
        statementDescription: "PGTO ITAU 64773",
        ledgerHistory: "BAIXA TIT. 000064773 BRADESCO",
        statementDocument: "64773",
        ledgerDocument: "000064773",
      });

      expect(scoreDivergent.bankHint).toBe(-20);
      expect(scoreDivergent.evidence).toContain("Bancos divergentes no histórico [ITAU vs BRADESCO] (-20)");
    });

    it("16. traceReconciliationCandidate returns score breakdown, evidence, and competing candidates", () => {
      const stmt: StatementRecord = {
        id: "s-trace",
        sourceId: "s-trace",
        bank: "341",
        agency: "1234",
        bankAccount: "12345",
        date: "2025-12-30",
        document: "64773",
        history: "PGTO ITAU 64773 - 25",
        value: "-1011.49",
        evidence: { fileId: "stmt-file-1", line: 10, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };
      const ldg1: LedgerRecord = {
        id: "l-trace-1",
        sourceId: "l-trace-1",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2025-12-30",
        document: "000064773",
        history: "BAIXA TIT. - 000064773 - ITAU UNIBANCO",
        value: "-1011.49",
        evidence: { fileId: "ldg-file-1", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };
      const ldg2: LedgerRecord = {
        id: "l-trace-2",
        sourceId: "l-trace-2",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2025-12-30",
        document: "000064774",
        history: "BAIXA TIT. - 000064774 - ITAU UNIBANCO",
        value: "-1011.49",
        evidence: { fileId: "ldg-file-1", line: 21, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const diag = traceReconciliationCandidate({
        statementRecord: stmt,
        ledgerRecord: ldg1,
        competingLedgers: [ldg2],
        signProfile: "BANK_LIABILITY",
      });

      expect(diag.statement?.bankHint).toBe("ITAU");
      expect(diag.ledger?.bankHint).toBe("ITAU");
      expect(diag.candidateComparison.bankHintCompatible).toBe(true);
      expect(diag.candidateComparison.score).toBeDefined();
      expect(diag.candidateComparison.score?.total).toBeGreaterThanOrEqual(100);
      expect(diag.candidateComparison.score?.evidence.length).toBeGreaterThan(0);
      expect(diag.candidateComparison.competingCandidates?.length).toBe(2);
      expect(diag.candidateComparison.finalDecision).toBe("MATCHED");
    });
  });
});
