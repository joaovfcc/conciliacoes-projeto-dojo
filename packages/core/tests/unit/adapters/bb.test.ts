import { describe, expect, it } from "vitest"

import { bbCurrentAccountAdapter, bbRendeFacilAdapter } from "../../../src/adapters/bb.js"
import { type ExtractedStatementSource } from "../../../src/statement-sources.js"

const sha256 = "e".repeat(64)

describe("Banco do Brasil adapters", () => {
  it("separates the current-account and Rende Fácil layouts", () => {
    const current = pdfSource(["Banco do Brasil\nConsultas - Extrato de conta corrente"])
    const investment = pdfSource(["Banco do Brasil\nBB RENDE FACIL\nResumo do mes"])

    expect(bbCurrentAccountAdapter.detect(current).matched).toBe(true)
    expect(bbRendeFacilAdapter.detect(current).matched).toBe(false)
    expect(bbCurrentAccountAdapter.detect(investment).matched).toBe(false)
    expect(bbRendeFacilAdapter.detect(investment).matched).toBe(true)
  })

  it("parses C/D movements and keeps opening and closing balances out of transactions", async () => {
    const document = await bbCurrentAccountAdapter.parse(pdfSource([
      "Banco do Brasil",
      "Consultas - Extrato de conta corrente",
      "Agencia 3320-0",
      "Conta corrente 756190-3",
      "25/11/2025 0000 00000 000 Saldo Anterior 0,00 C",
      "01/12/2025 0000 14134 612 Recebimento Fornecedor 200.420 100,00 C",
      "DETALHE DO FORNECEDOR",
      "03/12/2025 0000 13105 438 TED 120.301 40,00 D 60,00 C",
      "31/12/2025 0000 00000 999 S A L D O 60,00 C",
    ]))

    expect(document.identity).toMatchObject({
      bankCode: "001",
      bankName: "BANCO DO BRASIL",
      agency: { normalized: "33200" },
      account: { normalized: "7561903" },
    })
    expect(document.period).toEqual({ start: "2025-12-01", end: "2025-12-31" })
    expect(document.openingBalance).toBe("0.00")
    expect(document.closingBalance).toBe("60.00")
    expect(document.transactions).toEqual([
      expect.objectContaining({
        postingDate: "2025-12-01",
        documentNumber: "200.420",
        description: "612 Recebimento Fornecedor DETALHE DO FORNECEDOR",
        amount: "100.00",
        direction: "CREDIT",
      }),
      expect.objectContaining({
        postingDate: "2025-12-03",
        documentNumber: "120.301",
        description: "438 TED",
        amount: "-40.00",
        direction: "DEBIT",
        runningBalance: "60.00",
      }),
    ])
    expect(document.transactions).toHaveLength(2)
    expect(bbCurrentAccountAdapter.validate(document).accepted).toBe(true)
  })

  it("blocks a current-account statement whose balance equation does not close", async () => {
    const document = await bbCurrentAccountAdapter.parse(pdfSource([
      "Banco do Brasil",
      "Consultas - Extrato de conta corrente",
      "Agencia 3320-0 Conta corrente 756190-3",
      "25/11/2025 0000 00000 000 Saldo Anterior 0,00 C",
      "01/12/2025 0000 14134 612 Recebimento Fornecedor 200.420 100,00 C",
      "31/12/2025 0000 00000 999 S A L D O 90,00 C",
    ]))

    expect(bbCurrentAccountAdapter.validate(document)).toMatchObject({
      accepted: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "BALANCE_INTEGRITY_FAILED", severity: "ERROR" }),
      ]),
    })
  })

  it("parses Rende Fácil activity as informational entries only", async () => {
    const document = await bbRendeFacilAdapter.parse(pdfSource([
      "Banco do Brasil",
      "BB RENDE FACIL",
      "Agencia Conta",
      "3320-0 756190-3",
      "Saldo bruto em 31/12/2025 : R$ 2.074,71",
      "Rendimentos no mes: R$ 95,53",
      "01/12/2025 Aplicacao R$ 827.105,29 R$ 0,00 R$ 0,00 R$ 0,00 R$ 827.105,29",
      "03/12/2025 Resgate R$ 337,85 R$ 0,50 R$ 0,11 R$ 0,00 R$ 338,24",
    ]))

    expect(document.documentType).toBe("INVESTMENT_ACTIVITY")
    expect(document.period).toEqual({ start: "2025-12-01", end: "2025-12-31" })
    expect(document.closingBalance).toBe("2074.71")
    expect(document.transactions).toHaveLength(0)
    expect(document.investments).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "APPLICATION", postingDate: "2025-12-01", amount: "827105.29" }),
      expect.objectContaining({ kind: "REDEMPTION", postingDate: "2025-12-03", amount: "338.24" }),
      expect.objectContaining({ kind: "EARNING", amount: "95.53" }),
    ]))
    expect(bbRendeFacilAdapter.validate(document).accepted).toBe(true)
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
