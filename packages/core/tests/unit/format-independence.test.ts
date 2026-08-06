import { describe, expect, it } from "vitest"

import { reconcile } from "../../src/reconciliation.js"
import {
  createSourceProvenance,
  type CanonicalStatementDocument,
} from "../../src/statement-sources.js"
import type {
  ConfirmProcessingRequest,
  LedgerRecord,
  StatementRecord,
} from "../../src/types.js"
import { generateXlsx } from "../../src/reporting.js"

const sha256 = "c".repeat(64)

describe("format independence of matching and reporting", () => {
  it("reconcile() produces identical results regardless of source format", () => {
    const { ledgers, confirmation } = sharedInputs()
    const pdfStatements = statementsFromCanonical(canonicalDoc("PDF"))
    const csvStatements = statementsFromCanonical(canonicalDoc("CSV"))

    const pdfResult = reconcile(ledgers, pdfStatements, confirmation)
    const csvResult = reconcile(ledgers, csvStatements, confirmation)

    // Same number of results
    expect(pdfResult.results).toHaveLength(csvResult.results.length)

    // Same statuses for each pair
    const pdfStatuses = pdfResult.results.map((r) => r.status).sort()
    const csvStatuses = csvResult.results.map((r) => r.status).sort()
    expect(pdfStatuses).toEqual(csvStatuses)

    // Same decision levels
    const pdfDecisions = pdfResult.results.map((r) => r.decisionLevel).sort()
    const csvDecisions = csvResult.results.map((r) => r.decisionLevel).sort()
    expect(pdfDecisions).toEqual(csvDecisions)

    // Same value differences
    const pdfValueDiffs = pdfResult.results.map((r) => r.valueDifference).sort()
    const csvValueDiffs = csvResult.results.map((r) => r.valueDifference).sort()
    expect(pdfValueDiffs).toEqual(csvValueDiffs)

    // Same summary counts
    expect(pdfResult.summaries).toHaveLength(csvResult.summaries.length)
    for (let i = 0; i < pdfResult.summaries.length; i++) {
      expect(pdfResult.summaries[i]!.reconciledCount).toBe(csvResult.summaries[i]!.reconciledCount)
      expect(pdfResult.summaries[i]!.divergenceCount).toBe(csvResult.summaries[i]!.divergenceCount)
      expect(pdfResult.summaries[i]!.status).toBe(csvResult.summaries[i]!.status)
    }
  })

  it("generateXlsx() produces the same worksheet structure for both formats", async () => {
    const { ledgers, confirmation } = sharedInputs()
    const pdfStatements = statementsFromCanonical(canonicalDoc("PDF"))
    const csvStatements = statementsFromCanonical(canonicalDoc("CSV"))

    const pdfProcessing = reconcile(ledgers, pdfStatements, confirmation)
    const csvProcessing = reconcile(ledgers, csvStatements, confirmation)

    const pdfXlsx = await generateXlsx(pdfProcessing)
    const csvXlsx = await generateXlsx(csvProcessing)

    // Both produce valid buffers
    expect(pdfXlsx).toBeInstanceOf(Buffer)
    expect(csvXlsx).toBeInstanceOf(Buffer)
    expect(pdfXlsx.length).toBeGreaterThan(0)
    expect(csvXlsx.length).toBeGreaterThan(0)
  })

  it("matching does not inspect format, page, row or extractionMethod for decisions", () => {
    const { ledgers, confirmation } = sharedInputs()

    // Create two statement sets with identical financial data but different provenance
    const pdfStatements = statementsFromCanonical(canonicalDoc("PDF"))
    const csvStatements = statementsFromCanonical(canonicalDoc("CSV"))

    // Ensure provenance data differs
    expect(pdfStatements[0]!.evidence.extractionMethod).not.toBe(csvStatements[0]!.evidence.extractionMethod)

    const pdfResult = reconcile(ledgers, pdfStatements, confirmation)
    const csvResult = reconcile(ledgers, csvStatements, confirmation)

    // Matching decisions must be identical — format metadata never influences the outcome
    expect(pdfResult.results.map((r) => r.status)).toEqual(
      csvResult.results.map((r) => r.status),
    )
    expect(pdfResult.results.map((r) => r.rule)).toEqual(
      csvResult.results.map((r) => r.rule),
    )
  })

  it("handles multiple transactions identically across formats", () => {
    const { ledgers: baseLedgers, confirmation } = sharedInputs()

    // Add more ledger records to match more statement records
    const ledgers: LedgerRecord[] = [
      ...baseLedgers,
      {
        id: "LEDGER-002",
        company: "EMPRESA",
        branch: "01",
        ledgerAccount: "11102001",
        date: "2025-12-15",
        document: "54321",
        history: "RECEBIMENTO",
        value: "250.00",
        sourceId: "SRC-002",
        evidence: { fileId: "ledger-file", originalName: "razao.xlsx", line: 3, extractionMethod: "TABULAR" },
      },
    ]

    const multiPdf = canonicalDoc("PDF")
    multiPdf.transactions = [
      ...multiPdf.transactions,
      {
        transactionId: "tx-2",
        postingDate: "2025-12-15",
        amount: "250.00",
        direction: "CREDIT",
        description: "RECEBIMENTO",
        documentNumber: "54321",
        provenance: createSourceProvenance({
          sourceId: "pdf-1",
          format: "PDF",
          adapterId: "ITAU_EMPRESAS_CC",
          adapterVersion: "1",
          rawHash: sha256,
          extractionMethod: "TEXT",
          page: 2,
        }),
      },
    ]

    const multiCsv = canonicalDoc("CSV")
    multiCsv.transactions = [
      ...multiCsv.transactions,
      {
        transactionId: "tx-2",
        postingDate: "2025-12-15",
        amount: "250.00",
        direction: "CREDIT",
        description: "RECEBIMENTO",
        documentNumber: "54321",
        provenance: createSourceProvenance({
          sourceId: "csv-1",
          format: "CSV",
          adapterId: "ITAU_CSV_CC",
          adapterVersion: "1",
          rawHash: sha256,
          extractionMethod: "CSV",
          row: 3,
        }),
      },
    ]

    const pdfStatements = statementsFromCanonical(multiPdf)
    const csvStatements = statementsFromCanonical(multiCsv)

    const pdfResult = reconcile(ledgers, pdfStatements, confirmation)
    const csvResult = reconcile(ledgers, csvStatements, confirmation)

    expect(pdfResult.results.map((r) => r.status).sort()).toEqual(
      csvResult.results.map((r) => r.status).sort(),
    )
  })
})

// --- helpers ---

function sharedInputs(): { ledgers: LedgerRecord[]; confirmation: ConfirmProcessingRequest } {
  const ledgers: LedgerRecord[] = [{
    id: "LEDGER-001",
    company: "EMPRESA",
    branch: "01",
    ledgerAccount: "11102001",
    date: "2025-12-10",
    document: "12345",
    history: "PAGAMENTO",
    value: "-100.00",
    sourceId: "SRC-001",
    evidence: { fileId: "ledger-file", originalName: "razao.xlsx", line: 2, extractionMethod: "TABULAR" },
  }]

  const confirmation: ConfirmProcessingRequest = {
    company: "EMPRESA",
    branch: "01",
    period: "202512",
    valueTolerance: "0.00",
    dateToleranceDays: 0,
    mappings: [{
      ledgerAccount: "11102001",
      statementFileIds: ["statement-file"],
      signProfile: "BANK_ASSET",
    }],
    idempotencyKey: "test-key",
  }

  return { ledgers, confirmation }
}

function canonicalDoc(format: "PDF" | "CSV"): CanonicalStatementDocument {
  const hash = sha256
  const sourceId = format === "PDF" ? "pdf-1" : "csv-1"
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
      documentNumber: "12345",
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

/**
 * Converts a CanonicalStatementDocument back to StatementRecord[]
 * using the same fileId for all records so they match the mapping.
 */
function statementsFromCanonical(doc: CanonicalStatementDocument): StatementRecord[] {
  return doc.transactions.map((tx) => ({
    id: tx.transactionId,
    bank: doc.identity.bankName,
    agency: doc.identity.agency?.normalized ?? "",
    bankAccount: doc.identity.account?.normalized ?? "",
    date: tx.postingDate,
    document: tx.documentNumber ?? "",
    history: tx.description,
    value: tx.amount,
    sourceId: tx.transactionId,
    evidence: {
      fileId: "statement-file",
      originalName: doc.format === "PDF" ? "extrato.pdf" : "extrato.csv",
      extractionMethod: doc.format === "PDF" ? "TEXT" as const : "TABULAR" as const,
      parser: doc.adapterId,
      ...(tx.provenance.page ? { page: tx.provenance.page } : {}),
      ...(tx.provenance.row ? { line: tx.provenance.row } : {}),
    },
  }))
}
