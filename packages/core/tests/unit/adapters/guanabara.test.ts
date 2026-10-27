import { describe, expect, it } from "vitest"

import { guanabaraCurrentAccountAdapter, guanabaraLinkedAccountAdapter } from "../../../src/adapters/guanabara.js"
import type { ExtractedStatementSource } from "../../../src/statement-sources.js"

const sha256 = "e".repeat(64)

describe("Guanabara current-account adapters", () => {
  it("keeps current and linked account layout detection independent", () => {
    const current = pdfSource([statement("Extrato de conta corrente")])
    const linked = pdfSource([statement("Extrato de conta vinculada")])

    expect(guanabaraCurrentAccountAdapter.detect(current)).toMatchObject({ matched: true, score: 100 })
    expect(guanabaraCurrentAccountAdapter.detect(linked).matched).toBe(false)
    expect(guanabaraLinkedAccountAdapter.detect(linked)).toMatchObject({ matched: true, score: 100 })
    expect(guanabaraLinkedAccountAdapter.detect(current).matched).toBe(false)
  })

  it.each([
    ["conta corrente", guanabaraCurrentAccountAdapter, "GUANABARA_CC"],
    ["conta vinculada", guanabaraLinkedAccountAdapter, "GUANABARA_CONTA_VINCULADA"],
  ] as const)("accepts an explicit no-movement %s statement", async (title: string, adapter: any, layoutFamily: string) => {
    const document = await adapter.parse(pdfSource([statement(`Extrato de ${title}`)]))

    expect(document.layoutFamily).toBe(layoutFamily)
    expect(document.identity).toMatchObject({
      bankCode: "612",
      bankName: "GUANABARA",
      agency: { normalized: "0001" },
      account: { normalized: "123456" },
    })
    expect(document.period).toEqual({ start: "2025-12-01", end: "2025-12-31" })
    expect(document.closingBalance).toBe("0.00")
    expect(document.transactions).toHaveLength(0)
    expect(document.declaresNoMovements).toBe(true)
    expect(adapter.validate(document).accepted).toBe(true)
  })

  it("blocks a recognized layout without the explicit no-movement declaration", async () => {
    const document = await guanabaraCurrentAccountAdapter.parse(pdfSource([[
      "Banco Guanabara",
      "Extrato de conta corrente",
      "Codigo Banco: 612",
      "Agencia: 0001",
      "Conta: 12345-6",
      "Saldo em 31/12/2025 0,00",
    ].join("\n")]))

    expect(guanabaraCurrentAccountAdapter.validate(document)).toMatchObject({
      accepted: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "STATEMENT_MOVEMENTS_NOT_EXTRACTED", severity: "ERROR" }),
      ]),
    })
  })
})

function statement(title: string): string {
  return [
    "Banco Guanabara",
    title,
    "Codigo Banco: 612",
    "Agencia: 0001",
    "Conta: 12345-6",
    "Nao houve movimentacoes no periodo de 01/12/2025 ate 31/12/2025",
    "Saldo em 31/12/2025 0,00",
  ].join("\n")
}

function pdfSource(pageTexts: string[]): ExtractedStatementSource & { format: "PDF" } {
  return {
    sourceId: "test-source",
    format: "PDF",
    sha256,
    pages: pageTexts.map((text, index) => ({ page: index + 1, text, method: "TEXT" as const })),
  }
}
