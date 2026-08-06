import { describe, expect, it } from "vitest"

import { brbCurrentAccountAdapter } from "../../../src/adapters/brb-cc.js"
import { type ExtractedStatementSource } from "../../../src/statement-sources.js"

const sha256 = "d".repeat(64)

describe("BRB CC V2 adapter", () => {
  it("detects BRB current account with positive signatures", () => {
    const source = pdfSource([
      "DADOS DA CONTA ORIGEM\nTIPO DE EXTRATO\n",
    ])
    const result = brbCurrentAccountAdapter.detect(source)

    expect(result.matched).toBe(true)
    expect(result.score).toBe(100)
    expect(result.evidenceCodes.length).toBe(2)
  })

  it("parses single-line format", async () => {
    const source = pdfSource([
      [
        "DADOS DA CONTA ORIGEM",
        "NUMERO DA CONTA 12345-6",
        "10/12/2025 PAGAMENTO 123456 100,00 - 900,00",
      ].join("\n"),
    ])

    const doc = await brbCurrentAccountAdapter.parse(source)

    expect(doc.transactions).toHaveLength(1)
    expect(doc.transactions[0]!.amount).toBe("-100.00")
    expect(doc.transactions[0]!.direction).toBe("DEBIT")
    expect(doc.transactions[0]!.documentNumber).toBe("123456")
    expect(doc.transactions[0]!.runningBalance).toBe("900.00")
    expect(doc.identity.bankName).toBe("BRB")
    expect(doc.identity.account?.normalized).toBe("123456")
  })

  it("parses multi-line format", async () => {
    const source = pdfSource([
      [
        "DADOS DA CONTA ORIGEM",
        "NUMERO DA CONTA 12345-6",
        "10/12/2025",
        "RECEBIMENTO",
        "123456",
        "200,00",
        "+",
        "1.100,00",
        "11/12/2025", // Next date
      ].join("\n"),
    ])

    const doc = await brbCurrentAccountAdapter.parse(source)

    expect(doc.transactions).toHaveLength(1)
    expect(doc.transactions[0]!.amount).toBe("200.00")
    expect(doc.transactions[0]!.direction).toBe("CREDIT")
    expect(doc.transactions[0]!.documentNumber).toBe("123456")
    expect(doc.transactions[0]!.runningBalance).toBe("1100.00")
    expect(doc.identity.bankName).toBe("BRB")
  })

  it("skips SALDO lines", async () => {
    const source = pdfSource([
      [
        "NUMERO DA CONTA 12345-6",
        "10/12/2025 SALDO ANTERIOR 000000 900,00 + 900,00",
        "10/12/2025",
        "SALDO FINAL",
        "123456",
        "900,00",
        "+",
        "900,00",
      ].join("\n"),
    ])

    const doc = await brbCurrentAccountAdapter.parse(source)

    expect(doc.transactions).toHaveLength(0)
  })

  it("validates empty document as invalid if no no-movements declaration", async () => {
    const source = pdfSource(["DADOS DA CONTA ORIGEM\nNUMERO DA CONTA 12345-6\n"])
    const doc = await brbCurrentAccountAdapter.parse(source)
    const validation = await brbCurrentAccountAdapter.validate(doc)
    
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
