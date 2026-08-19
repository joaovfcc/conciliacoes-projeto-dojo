import { describe, it, expect } from "vitest";
import {
  normalizeDocumentId,
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

describe("Auditoria e Diagnóstico Estruturado em Massa — PGTO ITAU × BAIXA TIT", () => {
  const confirmation: ConfirmProcessingRequest = {
    company: "SPREAD",
    branch: "02",
    period: "202512",
    valueTolerance: "0.01",
    dateToleranceDays: 2,
    mappings: [
      {
        ledgerAccount: "11102012",
        statementFileIds: ["stmt-mass-file"],
        signProfile: "BANK_LIABILITY",
      },
    ],
    idempotencyKey: "test-payment-title-mass-key",
  };

  it("1. PGTO ITAU 64707 casa com BAIXA TIT. 000064707", () => {
    const stmt: StatementRecord = {
      id: "s-64707",
      sourceId: "s-64707",
      bank: "341",
      agency: "3377",
      bankAccount: "130002439",
      date: "2025-12-30",
      document: "64707",
      history: "PGTO ITAU 64707 - 25",
      value: "-1011.49",
      evidence: { fileId: "stmt-mass-file", line: 10, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
    };
    const ldg: LedgerRecord = {
      id: "l-64707",
      sourceId: "l-64707",
      company: "SPREAD",
      branch: "02",
      ledgerAccount: "11102012",
      date: "2025-12-30",
      document: "000064707",
      history: "BAIXA TIT. - 000064707 - ITAU UNIBANCO",
      value: "-1011.49",
      evidence: { fileId: "ldg-mass-file", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
    };

    const result = reconcile([ldg], [stmt], confirmation);
    expect(result.results.length).toBe(1);
    expect(result.results[0]?.status).toBe("AUTO_MATCH_EXACT");
    expect(result.results[0]?.rule).toBe("RF-02");
  });

  it("2. PGTO ITAU 64731 casa com BAIXA TIT. 000064731", () => {
    const stmt: StatementRecord = {
      id: "s-64731",
      sourceId: "s-64731",
      bank: "341",
      agency: "3377",
      bankAccount: "130002439",
      date: "2025-12-30",
      document: "64731",
      history: "PGTO ITAU 64731 - 25",
      value: "-1011.49",
      evidence: { fileId: "stmt-mass-file", line: 11, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
    };
    const ldg: LedgerRecord = {
      id: "l-64731",
      sourceId: "l-64731",
      company: "SPREAD",
      branch: "02",
      ledgerAccount: "11102012",
      date: "2025-12-30",
      document: "000064731",
      history: "BAIXA TIT. - 000064731 - ITAU UNIBANCO",
      value: "-1011.49",
      evidence: { fileId: "ldg-mass-file", line: 21, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
    };

    const result = reconcile([ldg], [stmt], confirmation);
    expect(result.results.length).toBe(1);
    expect(result.results[0]?.status).toBe("AUTO_MATCH_EXACT");
    expect(result.results[0]?.rule).toBe("RF-02");
  });

  it("3. PGTO ITAU 64834 casa com BAIXA TIT. 000064834", () => {
    const stmt: StatementRecord = {
      id: "s-64834",
      sourceId: "s-64834",
      bank: "341",
      agency: "3377",
      bankAccount: "130002439",
      date: "2025-12-30",
      document: "64834",
      history: "PGTO ITAU 64834 - 25",
      value: "-3739.47",
      evidence: { fileId: "stmt-mass-file", line: 12, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
    };
    const ldg: LedgerRecord = {
      id: "l-64834",
      sourceId: "l-64834",
      company: "SPREAD",
      branch: "02",
      ledgerAccount: "11102012",
      date: "2025-12-30",
      document: "000064834",
      history: "BAIXA TIT. - 000064834 - ITAU UNIBANCO",
      value: "-3739.47",
      evidence: { fileId: "ldg-mass-file", line: 22, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
    };

    const result = reconcile([ldg], [stmt], confirmation);
    expect(result.results.length).toBe(1);
    expect(result.results[0]?.status).toBe("AUTO_MATCH_EXACT");
    expect(result.results[0]?.rule).toBe("RF-02");
  });

  it("4. PGTO ITAU 64707 - 25 extrai documento 64707 e ignora código auxiliar 25", () => {
    const hint = extractFinancialHint("PGTO ITAU 64707 - 25", "64707");
    expect(hint.bankHint).toBe("ITAU");
    expect(hint.semanticCategory).toBe("PAYMENT_TITLE");
    expect(hint.comparisonTokens).toContain("64707");
    expect(hint.comparisonTokens).not.toContain("25");
  });

  it("5. PGTO ITAU é interpretado como débito quando o layout indicar saída/pagamento", () => {
    const stmt: StatementRecord = {
      id: "s-debit",
      sourceId: "s-debit",
      bank: "341",
      agency: "3377",
      bankAccount: "130002439",
      date: "2025-12-30",
      document: "64707",
      history: "PGTO ITAU 64707 - 25",
      value: "-1011.49",
      evidence: { fileId: "stmt-mass-file", line: 10, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
    };

    const trace = traceReconciliationCandidate({
      statementRecord: stmt,
      signProfile: "BANK_LIABILITY",
    });

    expect(trace.statement?.sign).toBe("negative");
    expect(trace.statement?.parsedAmountCents).toBe("-101149");
  });

  it("6. BAIXA TIT correspondente aparece no conjunto elegível e é auditada", () => {
    const ldg: LedgerRecord = {
      id: "l-eligible",
      sourceId: "l-eligible",
      company: "SPREAD",
      branch: "02",
      ledgerAccount: "11102012",
      date: "2025-12-30",
      document: "000064707",
      history: "BAIXA TIT. - 000064707 - ITAU UNIBANCO",
      value: "-1011.49",
      evidence: { fileId: "ldg-mass-file", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
    };

    const trace = traceReconciliationCandidate({
      ledgerRecord: ldg,
      signProfile: "BANK_LIABILITY",
    });

    expect(trace.ledger?.eligibility).toBe("ELIGIBLE");
    expect(trace.ledger?.normalizedDocument).toBe("64707");
    expect(trace.ledger?.bankHint).toBe("ITAU");
  });

  it("7. se BAIXA TIT estiver fora da conta bancária mapeada, fica unmapped e não concilia", () => {
    const stmt: StatementRecord = {
      id: "s-target",
      sourceId: "s-target",
      bank: "341",
      agency: "3377",
      bankAccount: "130002439",
      date: "2025-12-30",
      document: "64707",
      history: "PGTO ITAU 64707 - 25",
      value: "-1011.49",
      evidence: { fileId: "stmt-mass-file", line: 10, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
    };
    const ldgOtherAccount: LedgerRecord = {
      id: "l-other-account",
      sourceId: "l-other-account",
      company: "SPREAD",
      branch: "02",
      ledgerAccount: "1.1.2.0.1001", // Different accounting account (Clientes/Fornecedores)
      date: "2025-12-30",
      document: "000064707",
      history: "BAIXA TIT. - 000064707 - ITAU UNIBANCO",
      value: "-1011.49",
      evidence: { fileId: "ldg-mass-file", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
    };

    const result = reconcile([ldgOtherAccount], [stmt], confirmation);
    expect(result.results.length).toBe(2);
    expect(result.results.some((r) => r.status === "STATEMENT_WITHOUT_LEDGER")).toBe(true);
    expect(result.results.some((r) => r.status === "LEDGER_WITHOUT_STATEMENT" && r.rule === "RULE_7_UNMAPPED_LEDGER")).toBe(true);
  });

  it("8. traceReconciliationCandidate gera score breakdown completo para auditoria", () => {
    const stmt: StatementRecord = {
      id: "s-trace-audit",
      sourceId: "s-trace-audit",
      bank: "341",
      agency: "3377",
      bankAccount: "130002439",
      date: "2025-12-30",
      document: "64707",
      history: "PGTO ITAU 64707 - 25",
      value: "-1011.49",
      evidence: { fileId: "stmt-mass-file", line: 10, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
    };
    const ldg: LedgerRecord = {
      id: "l-trace-audit",
      sourceId: "l-trace-audit",
      company: "SPREAD",
      branch: "02",
      ledgerAccount: "11102012",
      date: "2025-12-30",
      document: "000064707",
      history: "BAIXA TIT. - 000064707 - ITAU UNIBANCO",
      value: "-1011.49",
      evidence: { fileId: "ldg-mass-file", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
    };

    const trace = traceReconciliationCandidate({
      statementRecord: stmt,
      ledgerRecord: ldg,
      signProfile: "BANK_LIABILITY",
    });

    expect(trace.candidateComparison.finalDecision).toBe("MATCHED");
    expect(trace.candidateComparison.score?.total).toBeGreaterThanOrEqual(140);
    expect(trace.candidateComparison.score?.evidence).toContain("Documento normalizado compatível [64707] (+40)");
  });

  it("9. nenhum match é criado por valor/data quando o documento é conflitante", () => {
    const score = calculateCandidateScore({
      statementDate: "2025-12-30",
      ledgerDate: "2025-12-30",
      statementAmountCents: -101149n,
      ledgerAmountCents: -101149n,
      statementDescription: "PGTO ITAU 64707 - 25",
      ledgerHistory: "BAIXA TIT. - 000064774 - ITAU UNIBANCO",
      statementDocument: "64707",
      ledgerDocument: "000064774",
    });

    expect(score.decision).toBe("REJECT");
    expect(score.documentNormalized).toBe(-30);
    expect(score.evidence).toContain("Documento divergente [64707 vs 64774] (-30)");
  });

  it("10. conciliação em lote dos 19 documentos roda com 100% de precisão e sem regressão", () => {
    const docs = [
      { doc: "64707", amount: "-1011.49" },
      { doc: "64731", amount: "-1011.49" },
      { doc: "64773", amount: "-1011.49" },
      { doc: "64834", amount: "-3739.47" },
      { doc: "64225", amount: "-306.51" },
      { doc: "64878", amount: "-3739.47" },
      { doc: "64214", amount: "-1011.49" },
      { doc: "64688", amount: "-1500.00" },
      { doc: "64728", amount: "-2250.80" },
      { doc: "64896", amount: "-1011.49" },
      { doc: "64752", amount: "-3739.47" },
      { doc: "64715", amount: "-1011.49" },
      { doc: "64751", amount: "-1011.49" },
      { doc: "64823", amount: "-3739.47" },
      { doc: "64282", amount: "-540.20" },
      { doc: "64886", amount: "-3739.47" },
      { doc: "64646", amount: "-1011.49" },
      { doc: "64712", amount: "-1011.49" },
      { doc: "64732", amount: "-1011.49" },
    ];

    const statements: StatementRecord[] = docs.map((item, i) => ({
      id: `stmt-${item.doc}`,
      sourceId: `stmt-${item.doc}`,
      bank: "341",
      agency: "3377",
      bankAccount: "130002439",
      date: "2025-12-30",
      document: item.doc,
      history: `PGTO ITAU ${item.doc} - 25`,
      value: item.amount,
      evidence: { fileId: "stmt-mass-file", line: 10 + i, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
    }));

    const ledgers: LedgerRecord[] = docs.map((item, i) => ({
      id: `ldg-${item.doc}`,
      sourceId: `ldg-${item.doc}`,
      company: "SPREAD",
      branch: "02",
      ledgerAccount: "11102012",
      date: "2025-12-30",
      document: `0000${item.doc}`,
      history: `BAIXA TIT. - 0000${item.doc} - ITAU UNIBANCO`,
      value: item.amount,
      evidence: { fileId: "ldg-mass-file", line: 20 + i, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
    }));

    const result = reconcile(ledgers, statements, confirmation);
    expect(result.results.length).toBe(19);
    expect(result.results.every((r) => r.status === "AUTO_MATCH_EXACT")).toBe(true);
    expect(result.results.every((r) => r.rule === "RF-02")).toBe(true);
  });
});
