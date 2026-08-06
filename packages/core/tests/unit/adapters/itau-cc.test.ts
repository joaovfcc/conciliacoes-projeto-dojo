import { describe, expect, it } from "vitest"

import { itauCurrentAccountAdapter } from "../../../src/adapters/itau-cc.js"
import { type ExtractedStatementSource } from "../../../src/statement-sources.js"

const sha256 = "d".repeat(64)

describe("Itaú CC V2 adapter", () => {
  it("detects Itaú current account with positive signatures", () => {
    const source = pdfSource([
      "EXTRATO DE CONTA CORRENTE\nSALDO RESUMIDO\n",
    ])
    const result = itauCurrentAccountAdapter.detect(source)

    expect(result.matched).toBe(true)
    expect(result.score).toBe(100)
    expect(result.evidenceCodes.length).toBe(2)
  })

  it("rejects Safra documents even if they have matching signatures", () => {
    const source = pdfSource([
      "EXTRATO DE CONTA CORRENTE\nSALDO RESUMIDO\nBANCO SAFRA\n",
    ])
    const result = itauCurrentAccountAdapter.detect(source)

    expect(result.matched).toBe(false)
  })

  it("parses single-line format", async () => {
    const source = pdfSource([
      [
        "AGENCIA: 1234 CONTA: 56789-0",
        "10/12/2025 PAGAMENTO 12345 100,00 -",
        "11/12 RECEBIMENTO 54321 200,00",
      ].join("\n"),
    ])

    const doc = await itauCurrentAccountAdapter.parse(source)

    expect(doc.transactions).toHaveLength(2)
    
    expect(doc.transactions[0]!.amount).toBe("-100.00")
    expect(doc.transactions[0]!.direction).toBe("DEBIT")
    expect(doc.transactions[0]!.documentNumber).toBe("12345")
    
    expect(doc.transactions[1]!.amount).toBe("200.00")
    expect(doc.transactions[1]!.direction).toBe("CREDIT")
    expect(doc.transactions[1]!.documentNumber).toBe("54321")

    expect(doc.identity.bankName).toBe("ITAU")
    expect(doc.identity.agency?.normalized).toBe("1234")
    expect(doc.identity.account?.normalized).toBe("567890")
  })

  it("skips SALDO lines", async () => {
    const source = pdfSource([
      [
        "AGENCIA: 1234 CONTA: 56789-0",
        "10/12 SALDO ANTERIOR 100,00",
        "10/12 SDO CTA/APL 200,00",
        "11/12 SALDO DO DIA 200,00",
        "12/12 SALDO FINAL 200,00",
        "13/12 SALDO DISPONIVEL 200,00",
      ].join("\n"),
    ])

    const doc = await itauCurrentAccountAdapter.parse(source)

    expect(doc.transactions).toHaveLength(0)
  })

  it("generates warning for incomplete OCR lines", async () => {
    const source = pdfSource([
      [
        "AGENCIA: 1234 CONTA: 56789-0",
        "10/12 PAGAMENTO INCOMPLETO", // Starts with date but no money value
      ].join("\n"),
    ])

    const doc = await itauCurrentAccountAdapter.parse(source)

    expect(doc.transactions).toHaveLength(0)
    expect(doc.issues).toContainEqual(expect.objectContaining({ 
      severity: "WARNING", 
      code: "OCR_LINHA_INCOMPLETA" 
    }))
  })

  it("validates empty document as invalid if no no-movements declaration", async () => {
    const source = pdfSource(["AGENCIA: 1234 CONTA: 56789-0\n"])
    const doc = await itauCurrentAccountAdapter.parse(source)
    const validation = await itauCurrentAccountAdapter.validate(doc)
    
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
