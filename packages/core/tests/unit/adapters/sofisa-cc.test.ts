import { describe, expect, it } from "vitest"

import { sofisaCurrentAccountAdapter } from "../../../src/adapters/sofisa-cc.js"
import { type ExtractedStatementSource } from "../../../src/statement-sources.js"

const sha256 = "d".repeat(64)

describe("Sofisa CC V2 adapter", () => {
  it("detects Sofisa current account with positive signatures", () => {
    const source = pdfSource([
      "EXTRATO 45 DIAS\nENTRADAS/SAIDAS\n",
    ])
    const result = sofisaCurrentAccountAdapter.detect(source)

    expect(result.matched).toBe(true)
    expect(result.score).toBe(100)
    expect(result.evidenceCodes.length).toBe(2)
  })

  it("parses single-line format with short year", async () => {
    const source = pdfSource([
      [
        "AGENCIA: 1234 CONTA: 56789-0",
        "10/12/25 123 PAGAMENTO FORNECEDOR 12345 - 100,00",
        "11/12/25 456 RECEBIMENTO CLIENTE 54321 200,00",
      ].join("\n"),
    ])

    const doc = await sofisaCurrentAccountAdapter.parse(source)

    expect(doc.transactions).toHaveLength(2)
    
    // Note: Sofisa parser pads the short year (25 -> 2025)
    expect(doc.transactions[0]!.postingDate).toBe("2025-12-10")
    expect(doc.transactions[0]!.amount).toBe("-100.00")
    expect(doc.transactions[0]!.direction).toBe("DEBIT")
    expect(doc.transactions[0]!.documentNumber).toBe("12345")
    
    expect(doc.transactions[1]!.postingDate).toBe("2025-12-11")
    expect(doc.transactions[1]!.amount).toBe("200.00")
    expect(doc.transactions[1]!.direction).toBe("CREDIT")
    expect(doc.transactions[1]!.documentNumber).toBe("54321")

    expect(doc.identity.bankName).toBe("SOFISA")
    expect(doc.identity.agency?.normalized).toBe("1234")
    expect(doc.identity.account?.normalized).toBe("567890")
  })

  it("skips SALDO DISPONIVEL lines", async () => {
    const source = pdfSource([
      [
        "AGENCIA: 1234 CONTA: 56789-0",
        "SALDO DISPONIVEL 1.000,00",
      ].join("\n"),
    ])

    const doc = await sofisaCurrentAccountAdapter.parse(source)

    expect(doc.transactions).toHaveLength(0)
  })

  it("validates empty document as invalid if no no-movements declaration", async () => {
    const source = pdfSource(["AGENCIA: 1234 CONTA: 56789-0\n"])
    const doc = await sofisaCurrentAccountAdapter.parse(source)
    const validation = await sofisaCurrentAccountAdapter.validate(doc)
    
    expect(validation.accepted).toBe(false)
    expect(validation.issues).toContainEqual(expect.objectContaining({ code: "STATEMENT_MOVEMENTS_NOT_EXTRACTED" }))
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
