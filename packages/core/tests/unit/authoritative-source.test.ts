import { describe, expect, it } from "vitest"

import {
  crosscheckSources,
  selectAuthoritativeSource,
} from "../../src/authoritative-source.js"
import {
  createSourceProvenance,
  type CanonicalStatementDocument,
} from "../../src/statement-sources.js"

const sha256Pdf = "a".repeat(64)
const sha256Csv = "b".repeat(64)

describe("authoritative source selection", () => {
  it("selects PDF_PRIMARY when only PDF is provided", () => {
    const pdf = canonicalDoc("PDF")
    const result = selectAuthoritativeSource(pdf, undefined)

    expect(result.status).toBe("SELECTED")
    if (result.status === "SELECTED") {
      expect(result.selection.mode).toBe("PDF_PRIMARY")
      expect(result.selection.authoritative).toBe(pdf)
      expect(result.selection.secondary).toBeUndefined()
      expect(result.selection.crosscheck.status).toBe("NOT_PROVIDED")
    }
  })

  it("selects CSV_PRIMARY when only CSV is provided", () => {
    const csv = canonicalDoc("CSV")
    const result = selectAuthoritativeSource(undefined, csv)

    expect(result.status).toBe("SELECTED")
    if (result.status === "SELECTED") {
      expect(result.selection.mode).toBe("CSV_PRIMARY")
      expect(result.selection.authoritative).toBe(csv)
      expect(result.selection.secondary).toBeUndefined()
      expect(result.selection.crosscheck.status).toBe("NOT_PROVIDED")
    }
  })

  it("returns NO_SOURCE when neither PDF nor CSV is provided", () => {
    const result = selectAuthoritativeSource(undefined, undefined)
    expect(result.status).toBe("NO_SOURCE")
  })

  it("selects PDF_PRIMARY_CSV_CROSSCHECK when both are provided and compatible", () => {
    const pdf = canonicalDoc("PDF")
    const csv = canonicalDoc("CSV")
    const result = selectAuthoritativeSource(pdf, csv)

    expect(result.status).toBe("SELECTED")
    if (result.status === "SELECTED") {
      expect(result.selection.mode).toBe("PDF_PRIMARY_CSV_CROSSCHECK")
      expect(result.selection.authoritative).toBe(pdf)
      expect(result.selection.secondary).toBe(csv)
      expect(result.selection.crosscheck.status).toBe("PASSED")
    }
  })

  it("detects crosscheck failure when PDF and CSV diverge on account", () => {
    const pdf = canonicalDoc("PDF")
    const csv = canonicalDoc("CSV")
    csv.identity = {
      ...csv.identity,
      account: { raw: "99999", normalized: "99999" },
    }
    const result = selectAuthoritativeSource(pdf, csv)

    expect(result.status).toBe("SELECTED")
    if (result.status === "SELECTED") {
      expect(result.selection.mode).toBe("PDF_PRIMARY_CSV_CROSSCHECK")
      expect(result.selection.crosscheck.status).toBe("FAILED")
      if (result.selection.crosscheck.status === "FAILED") {
        expect(result.selection.crosscheck.diagnostics).toContainEqual(
          expect.objectContaining({ field: "account" }),
        )
        expect(result.selection.crosscheck.issues.length).toBeGreaterThan(0)
        expect(result.selection.crosscheck.issues[0]!.code).toBe("SOURCE_CROSSCHECK_FAILED")
      }
    }
  })

  it("ensures movements are never duplicated — authoritative is always the single source", () => {
    const pdf = canonicalDoc("PDF")
    const csv = canonicalDoc("CSV")
    const result = selectAuthoritativeSource(pdf, csv)

    expect(result.status).toBe("SELECTED")
    if (result.status === "SELECTED") {
      // Only the authoritative source's transactions should be used
      expect(result.selection.authoritative.transactions).toHaveLength(1)
      // Secondary is present but its transactions must NOT be merged
      expect(result.selection.secondary).toBeDefined()
      expect(result.selection.authoritative.transactions).not.toBe(
        result.selection.secondary?.transactions,
      )
    }
  })
})

describe("crosscheck sources", () => {
  it("passes when PDF and CSV have identical normalized data", () => {
    const result = crosscheckSources(canonicalDoc("PDF"), canonicalDoc("CSV"))
    expect(result.status).toBe("PASSED")
    if (result.status === "PASSED") {
      expect(result.diagnostics).toHaveLength(0)
    }
  })

  it("fails on institution code divergence", () => {
    const pdf = canonicalDoc("PDF")
    const csv = { ...canonicalDoc("CSV"), institutionCode: "033" }
    const result = crosscheckSources(pdf, csv)

    expect(result.status).toBe("FAILED")
    if (result.status === "FAILED") {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ field: "institutionCode" }),
      )
    }
  })

  it("fails on transaction count divergence", () => {
    const pdf = canonicalDoc("PDF")
    const csv = canonicalDoc("CSV")
    csv.transactions = [...csv.transactions, {
      transactionId: "tx-extra",
      postingDate: "2025-12-15",
      amount: "-50.00",
      direction: "DEBIT" as const,
      description: "EXTRA",
      provenance: createSourceProvenance({
        sourceId: "csv-1",
        format: "CSV",
        adapterId: "ITAU_CSV_CC",
        adapterVersion: "1",
        rawHash: sha256Csv,
        extractionMethod: "CSV",
        row: 3,
      }),
    }]
    const result = crosscheckSources(pdf, csv)

    expect(result.status).toBe("FAILED")
    if (result.status === "FAILED") {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ field: "transactionCount" }),
      )
    }
  })

  it("fails on debit total divergence", () => {
    const pdf = canonicalDoc("PDF")
    const csv = canonicalDoc("CSV")
    // Change CSV debit amount
    csv.transactions = [{
      ...csv.transactions[0]!,
      amount: "-200.00",
    }]
    const result = crosscheckSources(pdf, csv)

    expect(result.status).toBe("FAILED")
    if (result.status === "FAILED") {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ field: "debitTotal" }),
      )
    }
  })

  it("fails on period divergence", () => {
    const pdf = canonicalDoc("PDF")
    const csv = canonicalDoc("CSV")
    csv.period = { start: "2025-11-01", end: "2025-11-30" }
    const result = crosscheckSources(pdf, csv)

    expect(result.status).toBe("FAILED")
    if (result.status === "FAILED") {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ field: "period" }),
      )
    }
  })

  it("fails on opening balance divergence when both provide balances", () => {
    const pdf = canonicalDoc("PDF")
    const csv = canonicalDoc("CSV")
    csv.openingBalance = "500.00"
    const result = crosscheckSources(pdf, csv)

    expect(result.status).toBe("FAILED")
    if (result.status === "FAILED") {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ field: "openingBalance" }),
      )
    }
  })

  it("skips balance comparison when one source does not provide them", () => {
    const pdf = canonicalDoc("PDF")
    const csv = canonicalDoc("CSV")
    delete (csv as Partial<CanonicalStatementDocument>).openingBalance
    delete (csv as Partial<CanonicalStatementDocument>).closingBalance
    const result = crosscheckSources(pdf, csv)

    // Should still pass because balance comparison is skipped
    expect(result.status).toBe("PASSED")
  })

  it("produces sanitized error issues with SOURCE_CROSSCHECK_FAILED code", () => {
    const pdf = canonicalDoc("PDF")
    const csv = { ...canonicalDoc("CSV"), institutionCode: "033" }
    const result = crosscheckSources(pdf, csv)

    expect(result.status).toBe("FAILED")
    if (result.status === "FAILED") {
      expect(result.issues).toHaveLength(result.diagnostics.length)
      for (const issue of result.issues) {
        expect(issue.code).toBe("SOURCE_CROSSCHECK_FAILED")
        expect(issue.severity).toBe("ERROR")
        expect(issue.message).not.toContain("private")
        expect(issue.guidance).toBeDefined()
      }
    }
  })
})

function canonicalDoc(format: "PDF" | "CSV"): CanonicalStatementDocument {
  const sourceId = format === "PDF" ? "pdf-1" : "csv-1"
  const hash = format === "PDF" ? sha256Pdf : sha256Csv
  const method = format === "PDF" ? "TEXT" : "CSV"

  return {
    sourceId,
    format,
    institutionCode: "341",
    documentType: "CURRENT_ACCOUNT",
    layoutFamily: format === "PDF" ? "ITAU_EMPRESAS_CC" : "ITAU_CSV_CC",
    adapterId: format === "PDF" ? "ITAU_EMPRESAS_CC" : "ITAU_CSV_CC",
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
        sourceId,
        format,
        adapterId: format === "PDF" ? "ITAU_EMPRESAS_CC" : "ITAU_CSV_CC",
        adapterVersion: "1",
        rawHash: hash,
        extractionMethod: method as "TEXT" | "CSV",
        ...(format === "PDF" ? { page: 1 } : { row: 2 }),
      }),
    }],
    openingBalance: "1000.00",
    closingBalance: "900.00",
    issues: [],
  }
}
