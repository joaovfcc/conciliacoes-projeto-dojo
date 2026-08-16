import { describe, expect, it } from "vitest"

import { daycovalCurrentAccountAdapter } from "../../../src/adapters/daycoval.js"
import type { ExtractedStatementSource } from "../../../src/statement-sources.js"

const sha256 = "d".repeat(64)

describe("Daycoval current-account adapter", () => {
  it("reorders reverse-chronological movements and validates every daily close", async () => {
    const source = pdfSource([[
      "Dayconnect - Banco Daycoval",
      "Extrato Detalhado",
      "Conta Corrente",
      "Titular Periodo Agencia Conta",
      "EMPRESA DE TESTE 02/11/2025 a 31/12/2025 0001 00012345-6",
      "Saldo anterior",
      "R$ 100,00",
      "Saldo atual R$ 125,00",
      "Terca-feira, 09 de dezembro Saldo: R$ 125,00",
      "09/12 RECEBIMENTO PIX TESTE R$ 50,00",
      "Segunda-feira, 08 de dezembro Saldo: R$ 75,00",
      "08/12 TARIFA TESTE -R$ 25,00",
      "Saldo Anterior R$ 100,00",
      "Impressao realizada em 31/12/2025 08:00:00",
      "dayconnect@daycoval.com.br",
    ].join("\n")])

    expect(daycovalCurrentAccountAdapter.detect(source)).toMatchObject({ matched: true, score: 100 })
    const document = await daycovalCurrentAccountAdapter.parse(source)
    expect(document.identity).toMatchObject({
      bankCode: "707",
      bankName: "DAYCOVAL",
      agency: { normalized: "0001" },
      account: { normalized: "000123456" },
    })
    expect(document.period).toEqual({ start: "2025-11-02", end: "2025-12-31" })
    expect(document.openingBalance).toBe("100.00")
    expect(document.closingBalance).toBe("125.00")
    expect(document.transactions).toEqual([
      expect.objectContaining({ postingDate: "2025-12-08", amount: "-25.00", direction: "DEBIT" }),
      expect.objectContaining({ postingDate: "2025-12-09", amount: "50.00", direction: "CREDIT" }),
    ])
    expect(document.transactions.every((transaction) => transaction.runningBalance === undefined)).toBe(true)
    expect(daycovalCurrentAccountAdapter.validate(document).accepted).toBe(true)
  })

  it("blocks the statement when a daily closing balance disagrees with the movements", async () => {
    const document = await daycovalCurrentAccountAdapter.parse(pdfSource([[
      "Dayconnect - Banco Daycoval",
      "Extrato Detalhado",
      "Conta Corrente",
      "Titular Periodo Agencia Conta",
      "EMPRESA DE TESTE 02/11/2025 a 31/12/2025 0001 00012345-6",
      "Saldo anterior R$ 100,00",
      "Saldo atual R$ 125,00",
      "Terca-feira, 09 de dezembro Saldo: R$ 125,00",
      "09/12 RECEBIMENTO PIX TESTE R$ 50,00",
      "Segunda-feira, 08 de dezembro Saldo: R$ 70,00",
      "08/12 TARIFA TESTE -R$ 25,00",
      "Impressao realizada em 31/12/2025 08:00:00",
    ].join("\n")]))

    expect(daycovalCurrentAccountAdapter.validate(document)).toMatchObject({
      accepted: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "BALANCE_INTEGRITY_FAILED", severity: "ERROR" }),
      ]),
    })
  })

  it("accepts a structurally complete generated statement with equal balances and no movements", async () => {
    const document = await daycovalCurrentAccountAdapter.parse(pdfSource([[
      "Dayconnect - Banco Daycoval",
      "Extrato Detalhado",
      "Conta Corrente",
      "Titular Periodo Agencia Conta",
      "EMPRESA DE TESTE 02/11/2025 a 31/12/2025 0001 00012345-6",
      "Saldo anterior",
      "R$ 100,00",
      "Saldo atual R$ 100,00",
      "Impressao realizada em 31/12/2025 08:00:00",
      "Central de Atendimento Dayconnect",
    ].join("\n")]))

    expect(document.transactions).toHaveLength(0)
    expect(document.declaresNoMovements).toBe(true)
    expect(daycovalCurrentAccountAdapter.validate(document).accepted).toBe(true)
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
