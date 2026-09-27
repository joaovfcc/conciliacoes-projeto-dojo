import { describe, it, expect } from "vitest";
import {
  extractDocumentNumber,
  resolveTransactionDocument,
  normalizeDocumentId,
  isDocumentIdentifier,
  NON_DOCUMENT_NUMERIC_CODES,
} from "../../src/normalization.js";
import { reconcile } from "../../src/reconciliation.js";
import type { StatementRecord, LedgerRecord, ConfirmProcessingRequest } from "../../src/types.js";

describe("Universal Bank & ERP Document Matching", () => {
  describe("1. extractDocumentNumber (Multi-Bank & Multi-ERP)", () => {
    it("extracts document from Protheus / ERP ledger histories", () => {
      expect(extractDocumentNumber("BAIXA TIT. - 000064833 - ITAU UNIBANCO")).toBe("64833");
      expect(extractDocumentNumber("BXA. JUROS - 000064833 - ITAU UNIBANCO")).toBe("64833");
      expect(extractDocumentNumber("BXA. MULTA - 000012345 - BRADESCO")).toBe("12345");
      expect(extractDocumentNumber("TIT. 000064833")).toBe("64833");
      expect(extractDocumentNumber("TITULO 98765")).toBe("98765");
      expect(extractDocumentNumber("LIQUIDACAO TITULO 54321")).toBe("54321");
    });

    it("extracts document from various Brazilian bank statement formats", () => {
      // Itaú
      expect(extractDocumentNumber("PGTO ITAU 64833 - 25")).toBe("64833");
      expect(extractDocumentNumber("SISPAG FORN 64833")).toBe("64833");

      // Bradesco
      expect(extractDocumentNumber("PAGTO ELETRONICO 0064833")).toBe("64833");
      expect(extractDocumentNumber("PAGFOR BRADESCO 64833")).toBe("64833");

      // Banco do Brasil
      expect(extractDocumentNumber("BB PAGTO ELETRONICO 64833")).toBe("64833");
      expect(extractDocumentNumber("LIQ.TIT.OUTRO BCO 64833")).toBe("64833");

      // Santander
      expect(extractDocumentNumber("PAGTO FORNECEDORES 64833")).toBe("64833");
      expect(extractDocumentNumber("LIQ.COBRANCA 64833")).toBe("64833");

      // Caixa Econômica Federal
      expect(extractDocumentNumber("DEB T COB 64833")).toBe("64833");
      expect(extractDocumentNumber("PAG BOLETO 64833")).toBe("64833");

      // Electronic transfers
      expect(extractDocumentNumber("TED 123456 FORNECEDOR")).toBe("123456");
      expect(extractDocumentNumber("PIX TRANSF 64833")).toBe("64833");
    });

    it("extracts commercial and tax documents (NF, Duplicata, Boleto)", () => {
      expect(extractDocumentNumber("NF 12345")).toBe("12345");
      expect(extractDocumentNumber("NF-E 00012345")).toBe("12345");
      expect(extractDocumentNumber("NOTA FISCAL 77889")).toBe("77889");
      expect(extractDocumentNumber("DUPLICATA 64833")).toBe("64833");
      expect(extractDocumentNumber("FATURA 64833")).toBe("64833");
      expect(extractDocumentNumber("BOLETO 64833")).toBe("64833");
      expect(extractDocumentNumber("DOC: 64833")).toBe("64833");
    });

    it("falls back to isolated significant numeric token", () => {
      expect(extractDocumentNumber("PAGAMENTO FORNECEDOR XYZ 64833")).toBe("64833");
      expect(extractDocumentNumber("FORNECEDOR SILVA 0064833")).toBe("64833");
    });

    it("returns undefined for non-document texts (preventing false positives)", () => {
      expect(extractDocumentNumber("TAR CONTA CORRENTE - PACOTE 01/2026")).toBeUndefined();
      expect(extractDocumentNumber("RESGATE AUTOMATICO - APLICACAO AUT")).toBeUndefined();
      expect(extractDocumentNumber("REND PAGO APLIC AUT")).toBeUndefined();
      expect(extractDocumentNumber("SALDO ANTERIOR")).toBeUndefined();
      expect(extractDocumentNumber("TRANSFERENCIA ENTRE CONTAS")).toBeUndefined();
      expect(extractDocumentNumber("")).toBeUndefined();
      expect(extractDocumentNumber(undefined)).toBeUndefined();
    });

    it("does not treat bank codes or years as document numbers", () => {
      expect(extractDocumentNumber("TARIFA BANCARIA 341")).toBeUndefined();
      expect(extractDocumentNumber("TRANSF 237")).toBeUndefined();
      expect(extractDocumentNumber("OPERACAO 2025")).toBeUndefined();
      expect(extractDocumentNumber("FECHAMENTO 2026")).toBeUndefined();
    });
  });

  describe("2. resolveTransactionDocument", () => {
    it("extracts document from history when document column is empty", () => {
      const doc = resolveTransactionDocument("", "BAIXA TIT. - 000064833 - ITAU UNIBANCO");
      expect(doc).toBe("64833");
    });

    it("extracts document from history when document column contains generic operation code (e.g. '25')", () => {
      const doc = resolveTransactionDocument("25", "PGTO ITAU 64833 - 25");
      expect(doc).toBe("64833");
    });

    it("extracts document from history when document column contains bank code (e.g. '341' or '237')", () => {
      const doc = resolveTransactionDocument("341", "PGTO ITAU 64833");
      expect(doc).toBe("64833");
    });

    it("preserves explicit valid document numbers", () => {
      expect(resolveTransactionDocument("000064833", "BAIXA TITULO")).toBe("64833");
      expect(resolveTransactionDocument("64833", "PAGAMENTO")).toBe("64833");
      expect(resolveTransactionDocument("NF-12345", "COMPRA")).toBe("NF-12345");
    });
  });

  describe("3. End-to-End 1:1 Match with Cross-Format Documents", () => {
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
      idempotencyKey: "test-cross-doc-1to1",
    };

    it("reconciles when statement has '25' + 'PGTO ITAU 64833' and ledger has empty doc + 'BAIXA TIT. - 000064833'", () => {
      const stmt: StatementRecord = {
        id: "s-1",
        sourceId: "s-1",
        bank: "341",
        agency: "1234",
        bankAccount: "12345",
        date: "2025-12-30",
        document: "25",
        history: "PGTO ITAU 64833 - 25",
        value: "-5000.00",
        evidence: { fileId: "stmt-file-1", line: 10, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };

      const ldg: LedgerRecord = {
        id: "l-1",
        sourceId: "l-1",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2025-12-31", // D+1 date difference
        document: "", // Empty in Protheus
        history: "BAIXA TIT. - 000064833 - ITAU UNIBANCO",
        value: "-5000.00",
        evidence: { fileId: "ldg-file-1", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const result = reconcile([ldg], [stmt], confirmation);
      expect(result.results).toHaveLength(1);
      const match = result.results[0]!;
      expect(match.status).toBe("AUTO_MATCH_UNIQUE_VALUE");
      expect(match.statement?.id).toBe("s-1");
      expect(match.ledger?.id).toBe("l-1");
    });
  });

  describe("4. End-to-End 1:N Split / Desdobro Match Ancorado em Documento", () => {
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
      idempotencyKey: "test-split-group-key",
    };

    it("successfully reconciles 1 statement (5578.56) to 2 ledger entries (5572.14 + 6.42) sharing document 64833 with D+1 tolerance", () => {
      // Real file row 1527:
      const stmt: StatementRecord = {
        id: "s-split-1527",
        sourceId: "s-split-1527",
        bank: "341",
        agency: "1234",
        bankAccount: "12345",
        date: "2025-12-30",
        document: "25",
        history: "PGTO ITAU 64833 - 25",
        value: "-5578.56",
        evidence: { fileId: "stmt-file-1", line: 1527, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };

      // Real file rows 18777 & 18824 (Principal + Juros):
      const ldgPrincipal: LedgerRecord = {
        id: "l-split-18777",
        sourceId: "l-split-18777",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2025-12-31",
        document: "",
        history: "BAIXA TIT. - 000064833 - ITAU UNIBANCO",
        value: "-5572.14",
        evidence: { fileId: "ldg-file-1", line: 18777, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const ldgInterest: LedgerRecord = {
        id: "l-split-18824",
        sourceId: "l-split-18824",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2025-12-31",
        document: "",
        history: "BAIXA TIT. - 000064833 - ITAU UNIBANCO",
        value: "-6.42",
        evidence: { fileId: "ldg-file-1", line: 18824, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const result = reconcile([ldgPrincipal, ldgInterest], [stmt], confirmation);

      expect(result.results).toHaveLength(1);
      const groupMatch = result.results[0]!;
      expect(groupMatch.status).toBe("GROUP_SUGGESTION");
      expect(groupMatch.rule).toBe("RF-04");
      expect(groupMatch.decisionLevel).toBe("REVIEW_REQUIRED");
      expect(groupMatch.statements).toHaveLength(1);
      expect(groupMatch.statements![0]!.id).toBe("s-split-1527");
      expect(groupMatch.ledgers).toHaveLength(2);
      expect(groupMatch.ledgers!.map((l) => l.id).sort()).toEqual(["l-split-18777", "l-split-18824"]);
      expect(groupMatch.valueDifference).toBe("0.00");
    });

    it("rejects group when documents diverge even if sum matches", () => {
      const stmt: StatementRecord = {
        id: "s-diff-doc",
        sourceId: "s-diff-doc",
        bank: "341",
        agency: "1234",
        bankAccount: "12345",
        date: "2025-12-30",
        document: "25",
        history: "PGTO ITAU 64833 - 25",
        value: "-5578.56",
        evidence: { fileId: "stmt-file-1", line: 10, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };

      const ldg1: LedgerRecord = {
        id: "l-diff-1",
        sourceId: "l-diff-1",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2025-12-31",
        document: "",
        history: "BAIXA TIT. - 000099999 - ITAU UNIBANCO", // Different document
        value: "-5572.14",
        evidence: { fileId: "ldg-file-1", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const ldg2: LedgerRecord = {
        id: "l-diff-2",
        sourceId: "l-diff-2",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2025-12-31",
        document: "",
        history: "BAIXA TIT. - 000099999 - ITAU UNIBANCO", // Different document
        value: "-6.42",
        evidence: { fileId: "ldg-file-1", line: 21, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const result = reconcile([ldg1, ldg2], [stmt], confirmation);
      expect(result.results.some((r) => r.status === "GROUP_SUGGESTION")).toBe(false);
      expect(result.results.filter((r) => r.status === "LEDGER_WITHOUT_STATEMENT")).toHaveLength(2);
      expect(result.results.filter((r) => r.status === "STATEMENT_WITHOUT_LEDGER")).toHaveLength(1);
    });

    it("rejects group when sums diverge by 1 cent", () => {
      const stmt: StatementRecord = {
        id: "s-diff-cent",
        sourceId: "s-diff-cent",
        bank: "341",
        agency: "1234",
        bankAccount: "12345",
        date: "2025-12-30",
        document: "25",
        history: "PGTO ITAU 64833 - 25",
        value: "-5578.56",
        evidence: { fileId: "stmt-file-1", line: 10, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };

      const ldg1: LedgerRecord = {
        id: "l-cent-1",
        sourceId: "l-cent-1",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2025-12-31",
        document: "",
        history: "BAIXA TIT. - 000064833 - ITAU UNIBANCO",
        value: "-5572.14",
        evidence: { fileId: "ldg-file-1", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const ldg2: LedgerRecord = {
        id: "l-cent-2",
        sourceId: "l-cent-2",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2025-12-31",
        document: "",
        history: "BAIXA TIT. - 000064833 - ITAU UNIBANCO",
        value: "-6.41", // 1 cent difference (total 5578.55 != 5578.56)
        evidence: { fileId: "ldg-file-1", line: 21, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const result = reconcile([ldg1, ldg2], [stmt], confirmation);
      expect(result.results.some((r) => r.status === "GROUP_SUGGESTION")).toBe(false);
    });

    it("rejects group when dates are outside dateToleranceDays", () => {
      const stmt: StatementRecord = {
        id: "s-out-window",
        sourceId: "s-out-window",
        bank: "341",
        agency: "1234",
        bankAccount: "12345",
        date: "2025-12-10", // 21 days before
        document: "25",
        history: "PGTO ITAU 64833 - 25",
        value: "-5578.56",
        evidence: { fileId: "stmt-file-1", line: 10, originalName: "extrato.xlsx", extractionMethod: "TABULAR" },
      };

      const ldg1: LedgerRecord = {
        id: "l-win-1",
        sourceId: "l-win-1",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2025-12-31",
        document: "",
        history: "BAIXA TIT. - 000064833 - ITAU UNIBANCO",
        value: "-5572.14",
        evidence: { fileId: "ldg-file-1", line: 20, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const ldg2: LedgerRecord = {
        id: "l-win-2",
        sourceId: "l-win-2",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102012",
        date: "2025-12-31",
        document: "",
        history: "BAIXA TIT. - 000064833 - ITAU UNIBANCO",
        value: "-6.42",
        evidence: { fileId: "ldg-file-1", line: 21, originalName: "razao.xlsx", extractionMethod: "TABULAR" },
      };

      const result = reconcile([ldg1, ldg2], [stmt], confirmation);
      expect(result.results.some((r) => r.status === "GROUP_SUGGESTION")).toBe(false);
    });
  });
});
