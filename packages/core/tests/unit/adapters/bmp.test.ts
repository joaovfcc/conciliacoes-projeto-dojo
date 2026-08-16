import { describe, expect, it } from "vitest"

import { bmpCurrentAccountAdapter } from "../../../src/adapters/bmp.js"
import { type ExtractedStatementSource } from "../../../src/statement-sources.js"

const sha256 = "f".repeat(64)

describe("BMP current-account adapter", () => {
  it("requires the duplicated BMP text-layer fingerprint", () => {
    const bmp = pdfSource([[
      "CPF/CNPJ CPF/CNPJ 19138940000170 Agencia Agencia 0001 - MATRIZ Conta Conta 884138-9",
      "Extrato da Conta Extrato da Conta",
      "Credito (R$) Credito (R$) Debito (R$) Debito (R$) Saldo (R$) Saldo (R$)",
    ].join("\n")])

    expect(bmpCurrentAccountAdapter.detect(bmp)).toMatchObject({ matched: true, score: 100 })
    expect(bmpCurrentAccountAdapter.detect(pdfSource(["Banco BMG\nExtrato da Conta"])).matched).toBe(false)
  })

  it("parses known credits and debits while keeping balance controls out of transactions", async () => {
    const document = await bmpCurrentAccountAdapter.parse(pdfSource([[
      "CPF/CNPJ CPF/CNPJ 19138940000170 Agencia Agencia 0001 - MATRIZ Conta Conta 884138-9",
      "Extrato da Conta Extrato da Conta",
      "Periodo: Periodo: 01/11/2025 - 31/12/2025",
      "01/11/2025 SALDO INICIAL SALDO INICIAL 0,00",
      "17/11/2025 RECEBIMENTO TED RECEBIMENTO TED 100,00 100,00",
      "DOCUMENTO DO RECEBIMENTO",
      "17/11/2025 ENVIO PIX ENVIO PIX 96,10 3,90",
      "17/11/2025 CUSTO ENVIO PIX CUSTO ENVIO PIX 3,90 0,00",
      "Saldo do Dia Saldo do Dia 0,00 0,00",
      "Saldo total atual Saldo total atual 0,00 C",
    ].join("\n")]))

    expect(document.identity).toMatchObject({
      bankCode: "274",
      bankName: "BMP",
      agency: { normalized: "0001" },
      account: { normalized: "8841389" },
    })
    expect(document.period).toEqual({ start: "2025-11-01", end: "2025-12-31" })
    expect(document.openingBalance).toBe("0.00")
    expect(document.closingBalance).toBe("0.00")
    expect(document.transactions).toEqual([
      expect.objectContaining({
        description: "RECEBIMENTO TED DOCUMENTO DO RECEBIMENTO",
        amount: "100.00",
        direction: "CREDIT",
        runningBalance: "100.00",
      }),
      expect.objectContaining({ description: "ENVIO PIX", amount: "-96.10", direction: "DEBIT", runningBalance: "3.90" }),
      expect.objectContaining({ description: "CUSTO ENVIO PIX", amount: "-3.90", direction: "DEBIT", runningBalance: "0.00" }),
    ])
    expect(document.transactions).toHaveLength(3)
    expect(bmpCurrentAccountAdapter.validate(document).accepted).toBe(true)
  })

  it("blocks an unknown history instead of guessing its missing credit/debit column", async () => {
    const document = await bmpCurrentAccountAdapter.parse(pdfSource([[
      "CPF/CNPJ CPF/CNPJ 19138940000170 Agencia Agencia 0001 - MATRIZ Conta Conta 884138-9",
      "Extrato da Conta Extrato da Conta",
      "Periodo: Periodo: 01/11/2025 - 31/12/2025",
      "01/11/2025 SALDO INICIAL SALDO INICIAL 0,00",
      "17/11/2025 HISTORICO NOVO HISTORICO NOVO 10,00 10,00",
      "Saldo total atual Saldo total atual 10,00 C",
    ].join("\n")]))

    expect(bmpCurrentAccountAdapter.validate(document)).toMatchObject({
      accepted: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "TRANSACTION_DIRECTION_UNKNOWN", severity: "ERROR" }),
      ]),
    })
    expect(document.transactions).toHaveLength(0)
  })

  it("blocks a recognized document when movements do not close against the final balance", async () => {
    const document = await bmpCurrentAccountAdapter.parse(pdfSource([[
      "CPF/CNPJ CPF/CNPJ 19138940000170 Agencia Agencia 0001 - MATRIZ Conta Conta 884138-9",
      "Extrato da Conta Extrato da Conta",
      "Periodo: Periodo: 01/11/2025 - 31/12/2025",
      "01/11/2025 SALDO INICIAL SALDO INICIAL 0,00",
      "17/11/2025 RECEBIMENTO TED RECEBIMENTO TED 100,00 100,00",
      "Saldo total atual Saldo total atual 90,00 C",
    ].join("\n")]))

    expect(bmpCurrentAccountAdapter.validate(document)).toMatchObject({
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
