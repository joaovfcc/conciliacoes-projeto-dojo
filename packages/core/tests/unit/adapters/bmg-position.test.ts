import { describe, expect, it } from "vitest"

import { bmgPositionAdapter } from "../../../src/adapters/bmg-position.js"
import { type ExtractedStatementSource } from "../../../src/statement-sources.js"

const sha256 = "b".repeat(64)

describe("BMG position adapter", () => {
  it("requires the BMG identity in addition to the investment-position layout", () => {
    const source = pdfSource([
      "Banco Safra",
      "Posicao e Performance",
      "Confira sua posicao de investimentos",
    ])

    expect(bmgPositionAdapter.detect(source).matched).toBe(false)
  })

  it("parses the BMG net position as informational evidence only", async () => {
    const source = pdfSource([
      "Banco BMG S.A.",
      "Posicao e Performance",
      "Confira sua posicao de investimentos",
      "Saldo Liquido R$ 521,280.44",
      "Extrato 02/01/2026",
      "CDB LIQUIDEZ DIARIA 100.00% CDI 15/08/25 18/05/27 01/02/26 500,000.00 527,458.63 6,178.19 521,280.44",
    ])

    expect(bmgPositionAdapter.detect(source)).toMatchObject({ matched: true, score: 100 })

    const document = await bmgPositionAdapter.parse(source)
    expect(document.identity).toMatchObject({ bankCode: "318", bankName: "BMG" })
    expect(document.period).toEqual({ start: "2026-01-02", end: "2026-01-02" })
    expect(document.closingBalance).toBe("521,280.44")
    expect(document.transactions).toHaveLength(0)
    expect(document.investments).toEqual([
      expect.objectContaining({
        kind: "POSITION",
        amount: "521280.44",
        description: "CDB LIQUIDEZ DIARIA",
      }),
    ])
    expect(document.issues).toContainEqual(expect.objectContaining({
      code: "POSICAO_INVESTIMENTO_INFORMATIVA",
      severity: "WARNING",
    }))
  })

  it("rejects a recognized document when no investment position is extracted", async () => {
    const document = await bmgPositionAdapter.parse(pdfSource([
      "Banco BMG S.A.",
      "Posicao e Performance",
      "Confira sua posicao de investimentos",
      "Extrato 02/01/2026",
    ]))

    expect(bmgPositionAdapter.validate(document)).toMatchObject({
      accepted: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "INVESTMENT_POSITIONS_NOT_EXTRACTED", severity: "ERROR" }),
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
