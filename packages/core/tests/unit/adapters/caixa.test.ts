import { describe, expect, it } from "vitest"

import { caixaCurrentAccountAdapter, caixaFundStatementAdapter } from "../../../src/adapters/caixa.js"
import type { ExtractedStatementSource } from "../../../src/statement-sources.js"

const sha256 = "b".repeat(64)

describe("Caixa adapters", () => {
  it("parses C/D current-account rows and excludes balance controls", async () => {
    const source = pdfSource([[
      "GERENCIADOR CAIXA",
      "Extrato por periodo",
      "Cliente: EMPRESA DE TESTE",
      "Conta: 1234 | 003 | 00001234-5",
      "Mes: Dezembro/2025",
      "Periodo: 1 - 31",
      "Data Mov. Nr. Doc. Historico Valor Saldo",
      "000000 SALDO ANTERIOR 0,00 100,00 C",
      "01/12/2025 123456 RECEBIMENTO TESTE 50,00 C 150,00 C",
      "02/12/2025 234567 PAGAMENTO TESTE 20,00 D 130,00 C",
      "02/12/2025 000000 SALDO DIA 0,00 C 130,00 C",
    ].join("\n")])

    expect(caixaCurrentAccountAdapter.detect(source)).toMatchObject({ matched: true, score: 100 })
    const document = await caixaCurrentAccountAdapter.parse(source)
    expect(document.identity).toMatchObject({
      bankCode: "104",
      bankName: "CAIXA",
      agency: { normalized: "1234" },
      account: { normalized: "000012345" },
    })
    expect(document.period).toEqual({ start: "2025-12-01", end: "2025-12-31" })
    expect(document.openingBalance).toBe("100.00")
    expect(document.closingBalance).toBe("130.00")
    expect(document.transactions).toEqual([
      expect.objectContaining({ amount: "50.00", direction: "CREDIT", runningBalance: "150.00" }),
      expect.objectContaining({ amount: "-20.00", direction: "DEBIT", runningBalance: "130.00" }),
    ])
    expect(document.transactions).toHaveLength(2)
    expect(document.transactions.every((transaction) => !/saldo/i.test(transaction.description))).toBe(true)
    expect(caixaCurrentAccountAdapter.validate(document).accepted).toBe(true)
  })

  it("blocks a Caixa current-account row whose extracted running balance does not close", async () => {
    const document = await caixaCurrentAccountAdapter.parse(pdfSource([[
      "GERENCIADOR CAIXA",
      "Extrato por periodo",
      "Conta: 1234 | 003 | 00001234-5",
      "Mes: Dezembro/2025",
      "Periodo: 1 - 31",
      "000000 SALDO ANTERIOR 0,00 100,00 C",
      "01/12/2025 123456 RECEBIMENTO TESTE 50,00 C 140,00 C",
      "01/12/2025 000000 SALDO DIA 0,00 C 140,00 C",
    ].join("\n")]))

    expect(caixaCurrentAccountAdapter.validate(document)).toMatchObject({
      accepted: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "BALANCE_INTEGRITY_FAILED", severity: "ERROR" }),
      ]),
    })
  })

  it("keeps the Caixa fund informational without duplicating summary and detailed redemptions", async () => {
    const source = pdfSource([[
      "CAIXA - Extrato de Fundos",
      "Extrato Fundo de Investimento",
      "Para simples verificacao",
      "Nome da Agencia Codigo Operacao Emissao",
      "AGENCIA TESTE 1234 0001 06/01/2026",
      "CPF/CNPJ Conta Corrente Mes/Ano Folha",
      "EMPRESA DE TESTE 00.000.000/0001- 003.00001234-",
      "12/2025 01/01",
      "ANALISE PERFIL DO INVESTIDOR 00 5",
      "Resumo da Movimentacao",
      "Historico Valor em R$ Qtde de Cotas",
      "Saldo Anterior 1.000,00C 10,000000",
      "Aplicacoes 0,00 0,000000",
      "Resgates 200,00D 2,000000",
      "Rendimento Bruto no Mes 10,00C",
      "IRRF 2,00D",
      "IOF 0,00",
      "Taxa de Saida 0,00",
      "Saldo Bruto* 808,00C 8,000000",
      "Resgate Bruto em Transito* 0,00",
      "Movimentacao Detalhada",
      "Data Historico Valor R$ Qtde de Cotas",
      "22 / 12 RESGATE 200,00D 2,000000",
      "IRRF 2,00D",
      "IOF 0,00",
    ].join("\n")])

    expect(caixaFundStatementAdapter.detect(source)).toMatchObject({ matched: true, score: 100 })
    const document = await caixaFundStatementAdapter.parse(source)
    expect(document.documentType).toBe("FUND_STATEMENT")
    expect(document.transactions).toHaveLength(0)
    expect(document.identity).toMatchObject({ agency: { normalized: "1234" }, account: { normalized: "003000012345" } })
    expect(document.period).toEqual({ start: "2025-12-01", end: "2025-12-31" })
    expect(document.investments).toEqual([
      expect.objectContaining({ kind: "REDEMPTION", postingDate: "2025-12-22", amount: "200.00" }),
      expect.objectContaining({ kind: "EARNING", amount: "10.00" }),
      expect.objectContaining({ kind: "POSITION", amount: "808.00" }),
    ])
    expect(document.investments).toHaveLength(3)
    expect(caixaFundStatementAdapter.validate(document).accepted).toBe(true)
  })

  it("blocks the fund when detailed redemptions disagree with the summary", async () => {
    const document = await caixaFundStatementAdapter.parse(pdfSource([[
      "CAIXA - Extrato de Fundos",
      "Extrato Fundo de Investimento",
      "Nome da Agencia Codigo Operacao Emissao",
      "AGENCIA TESTE 1234 0001 06/01/2026",
      "CPF/CNPJ Conta Corrente Mes/Ano Folha",
      "00.000.000/0001-00 003.00001234-5 12/2025 01/01",
      "Resumo da Movimentacao",
      "Saldo Anterior 1.000,00C",
      "Aplicacoes 0,00",
      "Resgates 200,00D",
      "Rendimento Bruto no Mes 10,00C",
      "IRRF 2,00D",
      "IOF 0,00",
      "Taxa de Saida 0,00",
      "Saldo Bruto* 808,00C",
      "Movimentacao Detalhada",
      "22 / 12 RESGATE 199,00D",
    ].join("\n")]))

    expect(caixaFundStatementAdapter.validate(document)).toMatchObject({
      accepted: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "INVESTMENT_SUMMARY_MISMATCH", severity: "ERROR" }),
      ]),
    })
  })
})

function pdfSource(pageTexts: string[]): ExtractedStatementSource & { format: "PDF" } {
  return {
    sourceId: "test-source",
    format: "PDF",
    sha256,
    pages: pageTexts.map((text, index) => ({ page: index + 1, text, method: "TEXT" as const })),
  }
}
