import { describe, expect, it } from "vitest"

import {
  bocomAnalyticCurrentAccountAdapter,
  bocomEmptyCurrentAccountAdapter,
} from "../../../src/adapters/bocom.js"
import { type ExtractedStatementSource } from "../../../src/statement-sources.js"

const sha256 = "a".repeat(64)

describe("Bocom BBM current-account adapters", () => {
  it("requires the BBM identity and analytic statement fingerprint", () => {
    const source = pdfSource([[
      "Conta corrente",
      "Razao social Banco | Agencia | C/C",
      "EMPRESA DE TESTE 107 2 123456-7",
      "Extrato de Conta - Analitico",
      "Banco BOCOM BBM S.A.",
    ].join("\n")])

    expect(bocomAnalyticCurrentAccountAdapter.detect(source)).toMatchObject({ matched: true, score: 100 })
    expect(bocomAnalyticCurrentAccountAdapter.detect(pdfSource(["Extrato de Conta - Analitico"])).matched).toBe(false)
  })

  it("parses split and inline movements and never turns balance rows into transactions", async () => {
    const document = await bocomAnalyticCurrentAccountAdapter.parse(pdfSource([
      [
        "Conta corrente",
        "Razao social Banco | Agencia | C/C",
        "EMPRESA DE TESTE 107 2 123456-7",
        "Extrato de Conta - Analitico",
        "Extrato do dia 01/12/2025 ao dia 31/12/2025",
        "SALDO ANTERIOR",
        "R$ 0,00",
        "01/12/2025",
        "DESCRICAO CONTRAPARTE VALOR",
        "RECEBIMENTO TESTE CLIENTE TESTE",
        "R$ 100,00",
        "TARIFA TESTE --- R$ -25,00",
        "SALDO FINAL TOTAL",
        "R$ 75,00",
      ].join("\n"),
      [
        "02/12/2025",
        "DESCRICAO CONTRAPARTE VALOR",
        "PAGAMENTO TESTE ---",
        "R$ -75,00",
        "SALDO FINAL TOTAL",
        "R$ 0,00",
        "SALDO FINAL",
        "R$ 0,00",
      ].join("\n"),
    ]))

    expect(document.identity).toMatchObject({
      bankCode: "107",
      bankName: "BOCOM BBM",
      agency: { normalized: "2" },
      account: { normalized: "1234567" },
    })
    expect(document.period).toEqual({ start: "2025-12-01", end: "2025-12-31" })
    expect(document.openingBalance).toBe("0.00")
    expect(document.closingBalance).toBe("0.00")
    expect(document.transactions).toEqual([
      expect.objectContaining({ postingDate: "2025-12-01", amount: "100.00", direction: "CREDIT" }),
      expect.objectContaining({ postingDate: "2025-12-01", amount: "-25.00", direction: "DEBIT" }),
      expect.objectContaining({ postingDate: "2025-12-02", amount: "-75.00", direction: "DEBIT" }),
    ])
    expect(document.transactions).toHaveLength(3)
    expect(document.transactions.every((transaction) => !/saldo/i.test(transaction.description))).toBe(true)
    expect(bocomAnalyticCurrentAccountAdapter.validate(document).accepted).toBe(true)
  })

  it("blocks the analytic layout when a daily balance does not close", async () => {
    const document = await bocomAnalyticCurrentAccountAdapter.parse(pdfSource([[
      "Conta corrente",
      "Razao social Banco | Agencia | C/C",
      "EMPRESA DE TESTE 107 2 123456-7",
      "Extrato de Conta - Analitico",
      "Extrato do dia 01/12/2025 ao dia 31/12/2025",
      "SALDO ANTERIOR",
      "R$ 0,00",
      "01/12/2025",
      "DESCRICAO CONTRAPARTE VALOR",
      "RECEBIMENTO TESTE R$ 100,00",
      "SALDO FINAL TOTAL",
      "R$ 90,00",
      "SALDO FINAL",
      "R$ 90,00",
    ].join("\n")]))

    expect(bocomAnalyticCurrentAccountAdapter.validate(document)).toMatchObject({
      accepted: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "BALANCE_INTEGRITY_FAILED", severity: "ERROR" }),
      ]),
    })
  })

  it("classifies the OCR-only empty statement without inventing a missing period", async () => {
    const source = pdfSource([[
      "Banco BOCOM BBM",
      "Conta corrente",
      "Extrato",
      "Conta: 107 2 123456-7",
      "R$ 0,00",
      "Sem transacoes",
      "Nao houve transacoes em sua conta nos ultimos 60 dias.",
    ].join("\n")], "OCR")

    expect(bocomEmptyCurrentAccountAdapter.detect(source)).toMatchObject({ matched: true, score: 100 })
    const document = await bocomEmptyCurrentAccountAdapter.parse(source)
    expect(document.transactions).toHaveLength(0)
    expect(document.declaresNoMovements).toBe(true)
    expect(document.closingBalance).toBe("0.00")
    expect(document.period).toBeUndefined()
    expect(bocomEmptyCurrentAccountAdapter.validate(document)).toMatchObject({
      accepted: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "STATEMENT_PERIOD_MISSING", severity: "ERROR" }),
      ]),
    })
  })
})

function pdfSource(pageTexts: string[], method: "TEXT" | "OCR" = "TEXT"): ExtractedStatementSource & { format: "PDF" } {
  return {
    sourceId: "test-source",
    format: "PDF",
    sha256,
    pages: pageTexts.map((text, index) => ({ page: index + 1, text, method })),
  }
}
