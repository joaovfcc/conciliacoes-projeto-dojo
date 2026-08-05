import { describe, expect, it } from "vitest";

import {
  buildInitialFormatAvailabilityMatrix,
  PDF_CORPUS_SUPPORT_MATRIX,
  summarizePdfSupportMatrix,
} from "../../src/corpus-support-matrix.js";

describe("PDF corpus support matrix", () => {
  it("covers the approved complete corpus without silently dropping a family", () => {
    const summary = summarizePdfSupportMatrix(PDF_CORPUS_SUPPORT_MATRIX);

    expect(PDF_CORPUS_SUPPORT_MATRIX).toHaveLength(35);
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

  it("declares structured formats as not provided and the account dimension as externally blocked", () => {
    const availability = buildInitialFormatAvailabilityMatrix(PDF_CORPUS_SUPPORT_MATRIX);

    expect(availability).toHaveLength(35);
    expect(availability.reduce((total, entry) => total + entry.pdfQuantity, 0)).toBe(68);
    expect(availability.every((entry) => entry.accountReferenceStatus === "AWAITING_PRIVATE_ACCOUNT_MANIFEST")).toBe(true);
    expect(availability.every((entry) => entry.formats.PDF === "PROVIDED")).toBe(true);
    expect(availability.every((entry) => entry.formats.OFX === "NOT_PROVIDED")).toBe(true);
    expect(availability.every((entry) => entry.formats.CSV === "NOT_PROVIDED")).toBe(true);
    expect(availability.every((entry) => entry.formats.BANK_XLSX === "NOT_PROVIDED")).toBe(true);
  });
});
