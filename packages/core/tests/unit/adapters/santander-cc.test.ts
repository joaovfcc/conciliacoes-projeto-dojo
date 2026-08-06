import { describe, expect, it } from "vitest"

import { santanderCurrentAccountAdapter } from "../../../src/adapters/santander-cc.js"
import { type ExtractedStatementSource } from "../../../src/statement-sources.js"

const sha256 = "d".repeat(64)

describe("Santander CC V2 adapter", () => {
  it("detects Santander current account with positive signatures", () => {
    const source = pdfSource([
      "INTERNET BANKING EMPRESARIAL\nCONTA CORRENTE\n",
    ])
    const result = santanderCurrentAccountAdapter.detect(source)

    expect(result.matched).toBe(true)
    expect(result.score).toBe(100)
    expect(result.evidenceCodes.length).toBe(2)
  })

  it("parses single-line format", async () => {
    const source = pdfSource([
      [
        "AGENCIA: 1234 CONTA: 56789-0",
        "10/12/2025 PAGAMENTO FORNECEDOR 123456 -100,00 900,00",
        "11/12/2025 RECEBIMENTO 654321 200,00 1.100,00",
      ].join("\n"),
    ])

    const doc = await santanderCurrentAccountAdapter.parse(source)

    expect(doc.transactions).toHaveLength(2)
    
    expect(doc.transactions[0]!.amount).toBe("-100.00")
    expect(doc.transactions[0]!.direction).toBe("DEBIT")
    expect(doc.transactions[0]!.documentNumber).toBe("123456")
    
    expect(doc.transactions[1]!.amount).toBe("200.00")
    expect(doc.transactions[1]!.direction).toBe("CREDIT")
    expect(doc.transactions[1]!.documentNumber).toBe("654321")

    expect(doc.identity.bankName).toBe("SANTANDER")
    expect(doc.identity.agency?.normalized).toBe("1234")
    expect(doc.identity.account?.normalized).toBe("567890")
  })

  it("skips SALDO lines", async () => {
    const source = pdfSource([
      [
        "AGENCIA: 1234 CONTA: 56789-0",
        "10/12/2025 SALDO ANTERIOR -100,00 900,00",
        "11/12/2025 SALDO FINAL 200,00 1.100,00",
      ].join("\n"),
    ])

    const doc = await santanderCurrentAccountAdapter.parse(source)

    expect(doc.transactions).toHaveLength(0)
  })

  it("validates empty document as invalid if no no-movements declaration", async () => {
    const source = pdfSource(["AGENCIA: 1234 CONTA: 56789-0\n"])
    const doc = await santanderCurrentAccountAdapter.parse(source)
    const validation = await santanderCurrentAccountAdapter.validate(doc)
    
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
