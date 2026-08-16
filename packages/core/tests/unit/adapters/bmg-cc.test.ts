import { describe, expect, it } from "vitest"

import { bmgCurrentAccountAdapter } from "../../../src/adapters/bmg-cc.js"
import { type ExtractedStatementSource } from "../../../src/statement-sources.js"

const sha256 = "c".repeat(64)

describe("BMG current-account adapter", () => {
  it("requires both the BMG identity and the account-statement layout", () => {
    const source = pdfSource(["BANCO SAFRA\nEXTRATO DA CONTA"])

    expect(bmgCurrentAccountAdapter.detect(source).matched).toBe(false)
  })

  it("parses credits, debits and wrapped descriptions without turning balances into transactions", async () => {
    const source = pdfSource([
      "Internet Banking - BMG",
      "EXTRATO DA CONTA",
      "Agencia: 5 Conta: 145908092-2",
      "Saldo Total (em 12/25): R$ 55.45",
      "Lancamento",
      "18/12/2025 LIQ EMISSAO CDB/LCA/LCI - PAGAMENTO DE Debito -R$ 363,318.16",
      "JUROS E AMORTIZACAO NC",
      "Lancamento",
      "18/12/2025 RECEBIMENTO PIX - EMPRESA Credito R$ 363,373.61",
      "Lancamento",
      "31/12/2025 R$ 55.45",
    ])

    expect(bmgCurrentAccountAdapter.detect(source)).toMatchObject({ matched: true, score: 100 })

    const document = await bmgCurrentAccountAdapter.parse(source)
    expect(document.identity).toMatchObject({
      bankCode: "318",
      bankName: "BMG",
      agency: { normalized: "5" },
      account: { normalized: "1459080922" },
    })
    expect(document.period).toEqual({ start: "2025-12-01", end: "2025-12-31" })
    expect(document.closingBalance).toBe("55.45")
    expect(document.transactions).toEqual([
      expect.objectContaining({
        postingDate: "2025-12-18",
        amount: "-363318.16",
        direction: "DEBIT",
        description: "LIQ EMISSAO CDB/LCA/LCI - PAGAMENTO DE JUROS E AMORTIZACAO NC",
      }),
      expect.objectContaining({
        postingDate: "2025-12-18",
        amount: "363373.61",
        direction: "CREDIT",
        description: "RECEBIMENTO PIX - EMPRESA",
      }),
    ])
    expect(document.transactions).toHaveLength(2)
  })

  it("accepts a structurally complete recognized statement with no movements", async () => {
    const document = await bmgCurrentAccountAdapter.parse(pdfSource([
      "Internet Banking - BMG",
      "EXTRATO DA CONTA",
      "Agencia: 5 Conta: 16995246-7",
      "Saldo Total (em 12/25): R$ 0.00",
      "Lancamento",
      "31/12/2025 R$ 0.00",
    ]))

    expect(document.transactions).toHaveLength(0)
    expect(document.declaresNoMovements).toBe(true)
    expect(bmgCurrentAccountAdapter.validate(document).accepted).toBe(true)
  })

  it("accepts the amount-before-label order emitted by the BMG PDF text layer", async () => {
    const document = await bmgCurrentAccountAdapter.parse(pdfSource([
      "Internet Banking - BMG",
      "EXTRATO DA CONTA",
      "Agencia: 5",
      "Conta: 16995246-7",
      "R$ 0.00 Saldo Total (em 12/25):",
      "31/12/2025 R$ 0.00",
    ]))

    expect(document.period).toEqual({ start: "2025-12-01", end: "2025-12-31" })
    expect(document.closingBalance).toBe("0.00")
    expect(document.declaresNoMovements).toBe(true)
  })

  it("blocks a statement whose repeated closing-balance controls disagree", async () => {
    const document = await bmgCurrentAccountAdapter.parse(pdfSource([
      "Internet Banking - BMG",
      "EXTRATO DA CONTA",
      "Agencia: 5 Conta: 16995246-7",
      "Saldo Total (em 12/25): R$ 100.00",
      "Lancamento",
      "31/12/2025 R$ 90.00",
    ]))

    expect(bmgCurrentAccountAdapter.validate(document)).toMatchObject({
      accepted: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "BALANCE_INTEGRITY_FAILED", severity: "ERROR" }),
      ]),
    })
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
