import { describe, expect, it } from "vitest"

import { abcCurrentAccountAdapter, abcLinkedAccountAdapter } from "../../../src/adapters/abc.js"
import { type ExtractedStatementSource } from "../../../src/statement-sources.js"

const sha256 = "a".repeat(64)

describe("ABC Brasil adapters", () => {
  it("separates the current-account and linked-account layout families", () => {
    const current = pdfSource(["0246 - Banco ABC Brasil\nExtrato detalhado de movimentacao"])
    const linked = pdfSource(["Banco: 0246 - BANCO ABC BRASIL\nExtrato detalhado da conta vinculada"])

    expect(abcCurrentAccountAdapter.detect(current).matched).toBe(true)
    expect(abcLinkedAccountAdapter.detect(current).matched).toBe(false)
    expect(abcCurrentAccountAdapter.detect(linked).matched).toBe(false)
    expect(abcLinkedAccountAdapter.detect(linked).matched).toBe(true)
    expect(abcCurrentAccountAdapter.detect(pdfSource(["Banco Safra\nExtrato detalhado de movimentacao"])).matched).toBe(false)
  })

  it("parses current-account movements and keeps balance rows out of transactions", async () => {
    const document = await abcCurrentAccountAdapter.parse(pdfSource([
      "CNPJ 19.138.940/0001-70 0246 - Banco ABC Brasil 0001-9 0023212359",
      "Extrato detalhado de movimentacao",
      "De 03/10/2025 a 31/12/2025",
      "Saldo da Conta Corrente R$ 100,00",
      "03/10/2025 - SALDO ANTERIOR - - 0,00",
      "10/10/2025 123456 RECEBIMENTO PIX Credito (+) 150,00 -",
      "11/10/2025 123457 PAGAMENTO PIX Debito (-) -50,00 100,00",
    ]))

    expect(document.identity).toMatchObject({
      bankCode: "246",
      bankName: "ABC BRASIL",
      agency: { normalized: "00019" },
      account: { normalized: "0023212359" },
    })
    expect(document.period).toEqual({ start: "2025-10-03", end: "2025-12-31" })
    expect(document.openingBalance).toBe("0.00")
    expect(document.closingBalance).toBe("100.00")
    expect(document.transactions).toEqual([
      expect.objectContaining({
        postingDate: "2025-10-10",
        documentNumber: "123456",
        description: "RECEBIMENTO PIX",
        amount: "150.00",
        direction: "CREDIT",
      }),
      expect.objectContaining({
        postingDate: "2025-10-11",
        documentNumber: "123457",
        description: "PAGAMENTO PIX",
        amount: "-50.00",
        direction: "DEBIT",
        runningBalance: "100.00",
      }),
    ])
    expect(abcCurrentAccountAdapter.validate(document).accepted).toBe(true)
  })

  it("accepts a linked account with an explicit no-movements declaration", async () => {
    const document = await abcLinkedAccountAdapter.parse(pdfSource([
      "Extrato detalhado da conta vinculada",
      "Banco: 0246 - BANCO ABC BRASIL",
      "Agencia: 0001-9 Conta: 0022391993",
      "Saldo da conta vinculada 0,00",
      "Periodo demonstrativo de De 03/10/2025 a 31/12/2025",
      "Nao existem lancamentos para o periodo selecionado",
    ]))

    expect(document.documentType).toBe("CURRENT_ACCOUNT")
    expect(document.layoutFamily).toBe("ABC_CONTA_VINCULADA")
    expect(document.transactions).toHaveLength(0)
    expect(document.declaresNoMovements).toBe(true)
    expect(document.closingBalance).toBe("0.00")
    expect(abcLinkedAccountAdapter.validate(document).accepted).toBe(true)
  })

  it("blocks a linked account without the explicit no-movements declaration", async () => {
    const document = await abcLinkedAccountAdapter.parse(pdfSource([
      "Extrato detalhado da conta vinculada",
      "Banco: 0246 - BANCO ABC BRASIL",
      "Agencia: 0001-9 Conta: 0022391993",
      "Saldo da conta vinculada 0,00",
      "Periodo demonstrativo de De 03/10/2025 a 31/12/2025",
    ]))

    expect(abcLinkedAccountAdapter.validate(document)).toMatchObject({
      accepted: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "STATEMENT_MOVEMENTS_NOT_EXTRACTED", severity: "ERROR" }),
      ]),
    })
  })

  it("blocks a current-account document when the closing controls disagree", async () => {
    const document = await abcCurrentAccountAdapter.parse(pdfSource([
      "CNPJ 19.138.940/0001-70 0246 - Banco ABC Brasil 0001-9 0023212359",
      "Extrato detalhado de movimentacao",
      "De 03/10/2025 a 31/12/2025",
      "Saldo da Conta Corrente R$ 90,00",
      "03/10/2025 - SALDO ANTERIOR - - 0,00",
      "11/10/2025 123457 RECEBIMENTO PIX Credito (+) 100,00 100,00",
    ]))

    expect(abcCurrentAccountAdapter.validate(document)).toMatchObject({
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
