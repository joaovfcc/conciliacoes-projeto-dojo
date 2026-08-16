import { describe, expect, it } from "vitest";

import {
  createSourceProvenance,
  isReconciliationEligibleDocumentType,
  sourceSupportKey,
  StatementSourceAdapterRegistry,
  type StatementSourceAdapter,
} from "../../src/statement-sources.js";

const sha256 = "a".repeat(64);

describe("canonical statement source contracts", () => {
  it("creates sanitized PDF provenance with stable coordinates", () => {
    const provenance = createSourceProvenance({
      sourceId: "statement-1",
      format: "PDF",
      adapterId: "ITAU_EMPRESAS_CC",
      adapterVersion: "1",
      rawHash: sha256,
      extractionMethod: "OCR",
      page: 2,
      confidence: 0.98,
    });

    expect(provenance).toEqual({
      sourceId: "statement-1",
      format: "PDF",
      adapterId: "ITAU_EMPRESAS_CC",
      adapterVersion: "1",
      rawHash: sha256,
      extractionMethod: "OCR",
      page: 2,
      confidence: 0.98,
    });
    expect(Object.keys(provenance)).not.toContain("originalName");
    expect(Object.keys(provenance)).not.toContain("sourceText");
  });

  it("rejects invalid hashes, positions, confidence and format-method combinations", () => {
    const base = {
      sourceId: "statement-1",
      format: "CSV" as const,
      adapterId: "GENERIC_CSV",
      adapterVersion: "1",
      rawHash: sha256,
      extractionMethod: "CSV" as const,
      row: 2,
    };

    expect(() => createSourceProvenance({ ...base, rawHash: "invalid" })).toThrow("SHA-256");
    expect(() => createSourceProvenance({ ...base, row: 0 })).toThrow("positive integer");
    expect(() => createSourceProvenance({ ...base, confidence: 1.1 })).toThrow("between 0 and 1");
    expect(() => createSourceProvenance({ ...base, extractionMethod: "OCR" })).toThrow("incompatible");
  });

  it("uses the complete support identity and keeps investments out of reconciliation", () => {
    expect(sourceSupportKey({
      format: "PDF",
      institutionCode: "341",
      documentType: "CURRENT_ACCOUNT",
      layoutFamily: "ITAU_EMPRESAS_CC",
      adapterVersion: "1",
    })).toBe("PDF:341:CURRENT_ACCOUNT:ITAU_EMPRESAS_CC:1");

    expect(isReconciliationEligibleDocumentType("CURRENT_ACCOUNT")).toBe(true);
    expect(isReconciliationEligibleDocumentType("INVESTMENT_ACTIVITY")).toBe(false);
    expect(isReconciliationEligibleDocumentType("INVESTMENT_POSITION")).toBe(false);
    expect(isReconciliationEligibleDocumentType("FUND_STATEMENT")).toBe(false);
  });

  it("selects by format and score while failing closed on ambiguity", () => {
    const selected = new StatementSourceAdapterRegistry([
      adapter("PDF_ITAU", "PDF", "341", "ITAU_EMPRESAS_CC", 95),
      adapter("PDF_OTHER", "PDF", "999", "OTHER_CC", 40),
      adapter("CSV_ITAU", "CSV", "341", "ITAU_CSV_CC", 100),
    ]).select({ sourceId: "source", format: "PDF", sha256, pages: [] });

    expect(selected.status).toBe("SELECTED");
    if (selected.status === "SELECTED") expect(selected.adapter.adapterId).toBe("PDF_ITAU");

    const ambiguous = new StatementSourceAdapterRegistry([
      adapter("PDF_A", "PDF", "341", "FAMILY_A", 90),
      adapter("PDF_B", "PDF", "341", "FAMILY_B", 85),
    ]).select({ sourceId: "source", format: "PDF", sha256, pages: [] });

    expect(ambiguous.status).toBe("AMBIGUOUS");
  });

  it("rejects duplicate support identities and resolves only an exact versioned key", () => {
    const first = adapter("PDF_ITAU_A", "PDF", "341", "ITAU_EMPRESAS_CC", 90);
    const duplicate = adapter("PDF_ITAU_B", "PDF", "341", "ITAU_EMPRESAS_CC", 80);
    expect(() => new StatementSourceAdapterRegistry([first, duplicate])).toThrow("Duplicate statement adapter support key");

    const registry = new StatementSourceAdapterRegistry([first]);
    expect(registry.resolve({
      format: "PDF",
      institutionCode: "341",
      documentType: "CURRENT_ACCOUNT",
      layoutFamily: "ITAU_EMPRESAS_CC",
      adapterVersion: "1",
    })?.adapterId).toBe("PDF_ITAU_A");
    expect(registry.resolve({
      format: "PDF",
      institutionCode: "341",
      documentType: "CURRENT_ACCOUNT",
      layoutFamily: "ITAU_EMPRESAS_CC",
      adapterVersion: "2",
    })).toBeUndefined();
  });
});

function adapter(
  adapterId: string,
  format: "PDF" | "CSV",
  institutionCode: string,
  layoutFamily: string,
  score: number,
): StatementSourceAdapter {
  return {
    adapterId,
    adapterVersion: "1",
    format,
    institutionCode,
    documentType: "CURRENT_ACCOUNT",
    layoutFamily,
    detect: () => ({ matched: true, score, evidenceCodes: [`${adapterId}_SIGNATURE`] }),
    parse: () => { throw new Error("not used by registry tests"); },
    validate: () => ({ accepted: true, issues: [] }),
  };
}
