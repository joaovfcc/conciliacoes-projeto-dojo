import { describe, it, expect } from "vitest";
import {
  normalizeDocumentId,
  normalizeDocument,
  extractDocumentNumber,
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

    it("does not extract SISPAG or PAGFOR internal lot numbers as document numbers", () => {
      expect(extractDocumentNumber("SISPAG FORNECEDORES 9128 - 25")).toBeUndefined();
      expect(extractDocumentNumber("SISPAGFORNECEDORES 9327 - 25")).toBeUndefined();
      expect(extractDocumentNumber("SISPAG TRIBUTOS 9121 - 25")).toBeUndefined();
      expect(extractDocumentNumber("SISPAG MODE IT TECHNOLO 9953 - 25")).toBeUndefined();
      expect(extractDocumentNumber("TED 755.1306.SOUZA 9925 - 25")).toBeUndefined();
      // Preserva títulos e NFs quando explicitamente indicados
      expect(extractDocumentNumber("SISPAG NF 35017 9128 - 25")).toBe("35017");
      expect(extractDocumentNumber("PGTO ITAU 64773 - 25")).toBe("64773");
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

  describe("6. Two-Pointers Counterparty Sweep, Truncated Protheus Names & Cascade Elimination", () => {
    const confirmation: ConfirmProcessingRequest = {
      company: "EMPRESA",
      branch: "01",
      period: "202609",
      valueTolerance: "0.01",
      dateToleranceDays: 2,
      mappings: [
        {
          ledgerAccount: "11102012",
          statementFileIds: ["stmt-file-1"],
          signProfile: "BANK_LIABILITY",
        },
      ],
      idempotencyKey: "test-wave4-key",
    };

    it("1. reconciles truncated Protheus names with neighbor-row noise on the same date via cascade", () => {
      const s1: StatementRecord = {
        id: "s-bianche",
        sourceId: "s-bianche",
        bank: "341",
        agency: "8363",
        bankAccount: "0000378-4",
        date: "2026-09-21",
        document: "",
        history: "PAGAMENTOS A FORNECEDORES - BIANCHE INFORMATICA LTDA QUANTUM TECH",
        value: "-5000.00",
        evidence: { fileId: "stmt-file-1", line: 10, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };
      const s2: StatementRecord = {
        id: "s-noah-leak",
        sourceId: "s-noah-leak",
        bank: "341",
        agency: "8363",
        bankAccount: "0000378-4",
        date: "2026-09-21",
        document: "",
        history: "PAGAMENTOS A FORNECEDORES - LTDA",
        value: "-5000.00",
        evidence: { fileId: "stmt-file-1", line: 11, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };
      const l1: LedgerRecord = {
        id: "l-bianche",
        sourceId: "l-bianche",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2026-09-21",
        document: "",
        history: "BAIXA TIT. - 000000001 - BIANCHE INFORMA",
        value: "-5000.00",
        evidence: { fileId: "ldg-file-1", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };
      const l2: LedgerRecord = {
        id: "l-noah",
        sourceId: "l-noah",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2026-09-21",
        document: "",
        history: "BAIXA TIT. - 000000002 - NOAH TCHALLA IN",
        value: "-5000.00",
        evidence: { fileId: "ldg-file-1", line: 21, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const result = reconcile([l1, l2], [s1, s2], confirmation);
      const matches = result.results.filter((r) => r.status === "AUTO_MATCH_EXACT");
      expect(matches).toHaveLength(2);

      const mBianche = matches.find((m) => m.ledger?.id === "l-bianche");
      expect(mBianche?.statement?.id).toBe("s-bianche");

      const mNoah = matches.find((m) => m.ledger?.id === "l-noah");
      expect(mNoah?.statement?.id).toBe("s-noah-leak");
    });

    it("2. disambiguates concatenated primary vs secondary supplier names on same date", () => {
      const s1: StatementRecord = {
        id: "s-kaeru-concat",
        sourceId: "s-kaeru-concat",
        bank: "341",
        agency: "8363",
        bankAccount: "0000378-4",
        date: "2026-09-21",
        document: "",
        history: "PAGAMENTOS A FORNECEDORES - KAERU TECNOLOGIA LTDA PAGAMENTOS A FORNECEDORES DLDD PRESTACAO",
        value: "-12000.24",
        evidence: { fileId: "stmt-file-1", line: 10, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };
      const s2: StatementRecord = {
        id: "s-dldd-pure",
        sourceId: "s-dldd-pure",
        bank: "341",
        agency: "8363",
        bankAccount: "0000378-4",
        date: "2026-09-21",
        document: "",
        history: "DLDD PRESTACAO DE SERVICOS",
        value: "-12000.24",
        evidence: { fileId: "stmt-file-1", line: 11, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };
      const l1: LedgerRecord = {
        id: "l-kaeru",
        sourceId: "l-kaeru",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2026-09-21",
        document: "",
        history: "BAIXA TIT. - 000000004 - KAERU TECNOLOGI",
        value: "-12000.24",
        evidence: { fileId: "ldg-file-1", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };
      const l2: LedgerRecord = {
        id: "l-dldd",
        sourceId: "l-dldd",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2026-09-21",
        document: "",
        history: "BAIXA TIT. - 000000005 - DLDD PRESTACAO",
        value: "-12000.24",
        evidence: { fileId: "ldg-file-1", line: 21, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const result = reconcile([l1, l2], [s1, s2], confirmation);
      const matches = result.results.filter((r) => r.status === "AUTO_MATCH_EXACT");
      expect(matches).toHaveLength(2);

      const mKaeru = matches.find((m) => m.ledger?.id === "l-kaeru");
      expect(mKaeru?.statement?.id).toBe("s-kaeru-concat");

      const mDldd = matches.find((m) => m.ledger?.id === "l-dldd");
      expect(mDldd?.statement?.id).toBe("s-dldd-pure");
    });

    it("3. handles TEDs with bank.agency. prefixes and CNPJs in document column", () => {
      const s1: StatementRecord = {
        id: "s-souza",
        sourceId: "s-souza",
        bank: "341",
        agency: "8363",
        bankAccount: "0000378-4",
        date: "2026-09-10",
        document: "33.009.911/0001-39",
        history: "TED - 755.1306.SOUZA C L SOUZA CRUZ LTDA",
        value: "-8000.00",
        evidence: { fileId: "stmt-file-1", line: 10, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };
      const l1: LedgerRecord = {
        id: "l-souza",
        sourceId: "l-souza",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2026-09-10",
        document: "",
        history: "BAIXA TIT. - 000000287 - SOUZA CRUZ LT",
        value: "-8000.00",
        evidence: { fileId: "ldg-file-1", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const s2: StatementRecord = {
        id: "s-spread",
        sourceId: "s-spread",
        bank: "341",
        agency: "8363",
        bankAccount: "0000378-4",
        date: "2026-09-12",
        document: "",
        history: "TED - 104.4280.SPREAD S E LTDA",
        value: "-15000.00",
        evidence: { fileId: "stmt-file-1", line: 11, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };
      const l2: LedgerRecord = {
        id: "l-spread",
        sourceId: "l-spread",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2026-09-12",
        document: "",
        history: "TRANSF. BANC. - 341 8363 00378",
        value: "-15000.00",
        evidence: { fileId: "ldg-file-1", line: 21, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const result = reconcile([l1, l2], [s1, s2], confirmation);
      const matches = result.results.filter((r) => r.status === "AUTO_MATCH_EXACT");
      expect(matches).toHaveLength(2);

      const mSouza = matches.find((m) => m.ledger?.id === "l-souza");
      expect(mSouza?.statement?.id).toBe("s-souza");

      const mSpread = matches.find((m) => m.ledger?.id === "l-spread");
      expect(mSpread?.statement?.id).toBe("s-spread");
    });

    it("4. reconciles duplicate entries of the same supplier on the same date via two-pointers sweep", () => {
      const s1: StatementRecord = {
        id: "s-claro-1",
        sourceId: "s-claro-1",
        bank: "341",
        agency: "8363",
        bankAccount: "0000378-4",
        date: "2026-09-28",
        document: "",
        history: "PAGAMENTOS A FORNECEDORES - CLARO S.A.",
        value: "-150.00",
        evidence: { fileId: "stmt-file-1", line: 10, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };
      const s2: StatementRecord = {
        id: "s-claro-2",
        sourceId: "s-claro-2",
        bank: "341",
        agency: "8363",
        bankAccount: "0000378-4",
        date: "2026-09-28",
        document: "",
        history: "PAGAMENTOS A FORNECEDORES - CLARO S.A.",
        value: "-150.00",
        evidence: { fileId: "stmt-file-1", line: 11, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };
      const l1: LedgerRecord = {
        id: "l-claro-1",
        sourceId: "l-claro-1",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2026-09-28",
        document: "",
        history: "BAIXA TIT. - 000001001 - CLARO S.A.",
        value: "-150.00",
        evidence: { fileId: "ldg-file-1", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };
      const l2: LedgerRecord = {
        id: "l-claro-2",
        sourceId: "l-claro-2",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2026-09-28",
        document: "",
        history: "BAIXA TIT. - 000001002 - CLARO S.A.",
        value: "-150.00",
        evidence: { fileId: "ldg-file-1", line: 21, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const result = reconcile([l1, l2], [s1, s2], confirmation);
      const matches = result.results.filter((r) => r.status === "AUTO_MATCH_EXACT");
      expect(matches).toHaveLength(2);
      expect(matches.map((m) => m.ledger?.id).sort()).toEqual(["l-claro-1", "l-claro-2"]);
      expect(matches.map((m) => m.statement?.id).sort()).toEqual(["s-claro-1", "s-claro-2"]);
    });

    it("5. enforces date tolerance window (<= 2 days matches when name matches clearly; > 2 days in multi-candidate does not)", () => {
      const sWithin: StatementRecord = {
        id: "s-embratel",
        sourceId: "s-embratel",
        bank: "341",
        agency: "8363",
        bankAccount: "0000378-4",
        date: "2026-09-22",
        document: "",
        history: "PAGAMENTOS A FORNECEDORES - EMBRATEL S.A.",
        value: "-3000.00",
        evidence: { fileId: "stmt-file-1", line: 10, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };
      const lWithin: LedgerRecord = {
        id: "l-embratel",
        sourceId: "l-embratel",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2026-09-20",
        document: "",
        history: "BAIXA TIT. - 000002001 - EMBRATEL",
        value: "-3000.00",
        evidence: { fileId: "ldg-file-1", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const resWithin = reconcile([lWithin], [sWithin], confirmation);
      expect(resWithin.results).toHaveLength(1);
      expect(resWithin.results[0]!.status).toMatch(/^AUTO_MATCH_/);

      const sOut: StatementRecord = {
        id: "s-out",
        sourceId: "s-out",
        bank: "341",
        agency: "8363",
        bankAccount: "0000378-4",
        date: "2026-09-25",
        document: "",
        history: "PAGAMENTOS A FORNECEDORES - MULTI FORNECEDOR",
        value: "-4000.00",
        evidence: { fileId: "stmt-file-1", line: 12, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };
      const lOut1: LedgerRecord = {
        id: "l-out-1",
        sourceId: "l-out-1",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2026-09-18",
        document: "",
        history: "BAIXA TIT. - MULTI FORNECEDOR",
        value: "-4000.00",
        evidence: { fileId: "ldg-file-1", line: 22, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };
      const lOut2: LedgerRecord = {
        id: "l-out-2",
        sourceId: "l-out-2",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2026-09-17",
        document: "",
        history: "BAIXA TIT. - MULTI FORNECEDOR",
        value: "-4000.00",
        evidence: { fileId: "ldg-file-1", line: 23, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const resOut = reconcile([lOut1, lOut2], [sOut], confirmation);
      expect(resOut.results.some((r) => r.status.startsWith("AUTO_MATCH"))).toBe(false);
      expect(resOut.results.some((r) => r.status === "AMBIGUOUS_MATCH")).toBe(true);
    });
  });
});
