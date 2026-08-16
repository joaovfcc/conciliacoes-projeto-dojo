import { describe, expect, it } from "vitest";

import {
  buildInitialFormatAvailabilityMatrix,
  PDF_CORPUS_SUPPORT_MATRIX,
  summarizePdfSupportMatrix,
} from "../../src/corpus-support-matrix.js";

describe("PDF corpus support matrix", () => {
  it("covers the approved complete corpus without silently dropping a family", () => {
    const summary = summarizePdfSupportMatrix(PDF_CORPUS_SUPPORT_MATRIX);

    expect(PDF_CORPUS_SUPPORT_MATRIX).toHaveLength(36);
    expect(summary.totalDocuments).toBe(68);
    expect(summary.totalInstitutions).toBe(18);
    expect(summary.byLot).toEqual({ 1: 20, 2: 12, 3: 10, 4: 7, 5: 17, 6: 2 });
  });

  it("uses a unique support key for every format, institution, document and family", () => {
    const keys = PDF_CORPUS_SUPPORT_MATRIX.map((entry) =>
      [entry.format, entry.institutionId, entry.documentType, entry.layoutFamily].join(":"),
    );

    expect(new Set(keys).size).toBe(keys.length);
    expect(PDF_CORPUS_SUPPORT_MATRIX.every((entry) => entry.quantity > 0)).toBe(true);
  });

  it("keeps all non-current-account documents outside automatic reconciliation", () => {
    const nonCurrent = PDF_CORPUS_SUPPORT_MATRIX.filter((entry) => entry.documentType !== "CURRENT_ACCOUNT");

    expect(nonCurrent.length).toBeGreaterThan(0);
    expect(nonCurrent.every((entry) => !entry.reconciliationEligible)).toBe(true);
  });

  it("records the BMG position adapter as awaiting an external oracle", () => {
    const bmgCurrentAccount = PDF_CORPUS_SUPPORT_MATRIX.find(
      (entry) => entry.layoutFamily === "BMG_CC_WEB",
    );
    const bmgPosition = PDF_CORPUS_SUPPORT_MATRIX.find(
      (entry) => entry.layoutFamily === "BMG_POSICAO_RENDIMENTO",
    );

    expect(bmgCurrentAccount).toMatchObject({
      documentType: "CURRENT_ACCOUNT",
      quantity: 4,
      currentStatus: "PARTIAL_ADAPTER",
      reconciliationEligible: true,
    });
    expect(bmgPosition).toMatchObject({
      documentType: "INVESTMENT_POSITION",
      quantity: 1,
      currentStatus: "AWAITING_ORACLE",
      reconciliationEligible: false,
    });
  });

  it("tracks the two observed ABC Brasil layout families independently", () => {
    const abcFamilies = PDF_CORPUS_SUPPORT_MATRIX.filter((entry) => entry.institutionId === "ABC_BRASIL");

    expect(abcFamilies).toEqual(expect.arrayContaining([
      expect.objectContaining({ layoutFamily: "ABC_CC_EXTRATO_DETALHADO", quantity: 2, currentStatus: "PARTIAL_ADAPTER" }),
      expect.objectContaining({ layoutFamily: "ABC_CONTA_VINCULADA", quantity: 2, currentStatus: "PARTIAL_ADAPTER" }),
    ]));
    expect(abcFamilies.reduce((total, entry) => total + entry.quantity, 0)).toBe(4);
  });

  it("keeps Banco do Brasil current-account and Rende Fácil support independent", () => {
    const bbFamilies = PDF_CORPUS_SUPPORT_MATRIX.filter((entry) => entry.institutionId === "BANCO_DO_BRASIL");

    expect(bbFamilies).toEqual(expect.arrayContaining([
      expect.objectContaining({ layoutFamily: "BB_CC_CONSULTAS", currentStatus: "PARTIAL_ADAPTER", reconciliationEligible: true }),
      expect.objectContaining({ layoutFamily: "BB_RENDE_FACIL_RESUMO", currentStatus: "AWAITING_ORACLE", reconciliationEligible: false }),
    ]));
  });

  it("tracks the textual and OCR-only Bocom BBM families independently", () => {
    const bocomFamilies = PDF_CORPUS_SUPPORT_MATRIX.filter((entry) => entry.institutionId === "BOCOM");

    expect(bocomFamilies).toEqual(expect.arrayContaining([
      expect.objectContaining({ layoutFamily: "BOCOM_CC_ANALITICO", extractionRequirement: "TEXT", currentStatus: "PARTIAL_ADAPTER" }),
      expect.objectContaining({ layoutFamily: "BOCOM_CC_EMPTY", extractionRequirement: "OCR", currentStatus: "AWAITING_OCR" }),
    ]));
  });

  it("keeps the Caixa fund outside reconciliation while tracking both implemented families", () => {
    const caixaFamilies = PDF_CORPUS_SUPPORT_MATRIX.filter((entry) => entry.institutionId === "CAIXA");

    expect(caixaFamilies).toEqual(expect.arrayContaining([
      expect.objectContaining({ layoutFamily: "CAIXA_CC_EXTRATO_PERIODO", currentStatus: "PARTIAL_ADAPTER", reconciliationEligible: true }),
      expect.objectContaining({ layoutFamily: "CAIXA_FUNDO_EXTRATO", currentStatus: "AWAITING_ORACLE", reconciliationEligible: false }),
    ]));
  });

  it("tracks the three Daycoval samples under the versioned detailed-statement adapter", () => {
    expect(PDF_CORPUS_SUPPORT_MATRIX.find((entry) => entry.institutionId === "DAYCOVAL")).toMatchObject({
      layoutFamily: "DAYCOVAL_CC_EXTRATO_DETALHADO",
      quantity: 3,
      currentStatus: "PARTIAL_ADAPTER",
      reconciliationEligible: true,
    });
  });

  it("declares structured formats as not provided and the account dimension as externally blocked", () => {
    const availability = buildInitialFormatAvailabilityMatrix(PDF_CORPUS_SUPPORT_MATRIX);

    expect(availability).toHaveLength(36);
    expect(availability.reduce((total, entry) => total + entry.pdfQuantity, 0)).toBe(68);
    expect(availability.every((entry) => entry.accountReferenceStatus === "AWAITING_PRIVATE_ACCOUNT_MANIFEST")).toBe(true);
    expect(availability.every((entry) => entry.formats.PDF === "PROVIDED")).toBe(true);
    expect(availability.every((entry) => entry.formats.OFX === "NOT_PROVIDED")).toBe(true);
    expect(availability.every((entry) => entry.formats.CSV === "NOT_PROVIDED")).toBe(true);
    expect(availability.every((entry) => entry.formats.BANK_XLSX === "NOT_PROVIDED")).toBe(true);
  });
});
