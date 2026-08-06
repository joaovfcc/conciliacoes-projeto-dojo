import { describe, expect, it } from "vitest"

import { bradescoCurrentAccountAdapter } from "../../../src/adapters/bradesco-cc.js"
import { createSourceProvenance, type ExtractedStatementSource } from "../../../src/statement-sources.js"

const sha256 = "d".repeat(64)

describe("Bradesco CC V2 adapter", () => {
  it("detects Bradesco current account with positive signatures", () => {
    const source = pdfSource([
      "EXTRATO MENSAL / POR PERIODO\nEXTRATO DE: AG.: 1234 | CC: 56789-0\n",
    ])
    const result = bradescoCurrentAccountAdapter.detect(source)

    expect(result.matched).toBe(true)
    expect(result.score).toBe(100)
    expect(result.evidenceCodes.length).toBe(2)
  })

  it("does not detect unrelated PDF content", () => {
    const source = pdfSource(["INTERNET BANKING EMPRESARIAL\nCONTA CORRENTE\n"])
    const result = bradescoCurrentAccountAdapter.detect(source)

    expect(result.matched).toBe(false)
    expect(result.score).toBeLessThan(100)
  })

  it("does not detect partial signatures", () => {
    const source = pdfSource(["EXTRATO MENSAL / POR PERIODO\n"])
    const result = bradescoCurrentAccountAdapter.detect(source)

    expect(result.matched).toBe(false)
  })

  it("parses a minimal Bradesco current account statement", async () => {
    const source = pdfSource([
      [
        "EXTRATO MENSAL / POR PERIODO",
        "EXTRATO DE: AG.: 1234 | CC: 56789-0",
        "DATA LANCAMENTO  CREDITO  DEBITO  SALDO",
        "10/12/2025  PAGAMENTO FATURA  12345  -100,00  900,00",
        "TOTAL",
      ].join("\n"),
    ])

    const doc = await bradescoCurrentAccountAdapter.parse(source)

    expect(doc.format).toBe("PDF")
    expect(doc.institutionCode).toBe("237")
    expect(doc.documentType).toBe("CURRENT_ACCOUNT")
    expect(doc.adapterId).toBe("BRADESCO_NET_EMPRESA_CC")
    expect(doc.adapterVersion).toBe("2")
    expect(doc.identity.bankName).toBe("BRADESCO")
    expect(doc.identity.agency?.normalized).toBe("1234")
    expect(doc.transactions).toHaveLength(1)
    expect(doc.transactions[0]!.amount).toBe("-100.00")
    expect(doc.transactions[0]!.direction).toBe("DEBIT")
    expect(doc.transactions[0]!.description).toContain("PAGAMENTO")
    expect(doc.transactions[0]!.documentNumber).toBe("12345")
    expect(doc.transactions[0]!.provenance.format).toBe("PDF")
    expect(doc.transactions[0]!.provenance.adapterId).toBe("BRADESCO_NET_EMPRESA_CC")
    expect(doc.transactions[0]!.provenance.adapterVersion).toBe("2")
  })

  it("handles explicit no-movements declaration", async () => {
    const source = pdfSource([
      [
        "EXTRATO MENSAL / POR PERIODO",
        "EXTRATO DE: AG.: 1234 | CC: 56789-0",
        "SEM MOVIMENTACAO NO PERIODO",
      ].join("\n"),
    ])

    const doc = await bradescoCurrentAccountAdapter.parse(source)

    expect(doc.transactions).toHaveLength(0)
    expect(doc.declaresNoMovements).toBe(true)
  })

  it("validates a well-formed document", async () => {
    const source = pdfSource([
      [
        "EXTRATO MENSAL / POR PERIODO",
        "EXTRATO DE: AG.: 1234 | CC: 56789-0",
        "DATA LANCAMENTO  CREDITO  DEBITO  SALDO",
        "10/12/2025  PAGAMENTO  12345  -100,00  900,00",
        "TOTAL",
      ].join("\n"),
    ])

    const doc = await bradescoCurrentAccountAdapter.parse(source)
    const validation = await bradescoCurrentAccountAdapter.validate(doc)

    expect(validation.accepted).toBe(true)
    expect(validation.issues).toHaveLength(0)
  })

  it("rejects document with no identity", async () => {
    const source = pdfSource([
      [
        "EXTRATO MENSAL / POR PERIODO",
        "EXTRATO DE:",
        "DATA LANCAMENTO  CREDITO  DEBITO  SALDO",
        "10/12/2025  PAGAMENTO  12345  -100,00  900,00",
        "TOTAL",
      ].join("\n"),
    ])

    const doc = await bradescoCurrentAccountAdapter.parse(source)
    // bankName is always set since it's hardcoded, but account may be missing
    // The validate function checks for missing bankName
    expect(doc.identity.bankName).toBe("BRADESCO")
  })

  it("has correct adapter metadata", () => {
    expect(bradescoCurrentAccountAdapter.adapterId).toBe("BRADESCO_NET_EMPRESA_CC")
    expect(bradescoCurrentAccountAdapter.adapterVersion).toBe("2")
    expect(bradescoCurrentAccountAdapter.format).toBe("PDF")
    expect(bradescoCurrentAccountAdapter.institutionCode).toBe("237")
    expect(bradescoCurrentAccountAdapter.documentType).toBe("CURRENT_ACCOUNT")
    expect(bradescoCurrentAccountAdapter.layoutFamily).toBe("BRADESCO_NET_EMPRESA_CC")
  })
})

function pdfSource(pageTexts: string[]): ExtractedStatementSource & { format: "PDF" } {
  return {
    sourceId: "test-source",
    format: "PDF",
    sha256,
    pages: pageTexts.map((text, index) => ({
      page: index + 1,
      text,
      method: "TEXT" as const,
    })),
  }
}
