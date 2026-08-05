import { describe, expect, it } from "vitest";

import {
  createSourceProvenance,
  isReconciliationEligibleDocumentType,
  sourceSupportKey,
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
  });
});
