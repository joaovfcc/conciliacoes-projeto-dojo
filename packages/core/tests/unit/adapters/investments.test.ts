import { describe, expect, it } from "vitest"

import { bradescoInvestmentAdapter } from "../../../src/adapters/bradesco-investment.js"
import { itauInvestmentAdapter } from "../../../src/adapters/itau-investment.js"
import { santanderInvestmentAdapter } from "../../../src/adapters/santander-investment.js"
import { sofisaPositionAdapter } from "../../../src/adapters/sofisa-position.js"
import { type ExtractedStatementSource } from "../../../src/statement-sources.js"

const sha256 = "d".repeat(64)

describe("Investment V2 adapters", () => {
  describe("Bradesco Investment", () => {
    it("parses applications and redemptions", async () => {
      const source = pdfSource([
        "237 | 12345-6 AGENCIA/CONTA",
        "10/12/2025 10/12/2025 1234 APLICAÇÃO - 1.000,00",
        "11/12/2025 11/12/2025 5678 RESGATE 500,00",
      ])
      const doc = await bradescoInvestmentAdapter.parse(source)
      expect(doc.investments).toHaveLength(2)
      expect(doc.investments?.[0]?.kind).toBe("APPLICATION")
      expect(doc.investments?.[0]?.amount).toBe("1000.00")
      expect(doc.investments?.[1]?.kind).toBe("REDEMPTION")
      expect(doc.investments?.[1]?.amount).toBe("500.00")
      expect(doc.issues[0]?.code).toBe("MOVIMENTOS_INVESTIMENTO_INFORMATIVOS")
    })
  })

  describe("Itaú Investment", () => {
    it("parses applications, redemptions and earnings", async () => {
      const source = pdfSource([
        "AGENCIA: 1234 CONTA: 56789-0",
        "10/12/2025 APLICACAO 100,00",
        "11/12/2025 RESGATE 50,00",
        "RENDIMENTO REFERENTE AO MES 10,00",
      ])
      const doc = await itauInvestmentAdapter.parse(source)
      expect(doc.investments).toHaveLength(3)
      expect(doc.investments?.[0]?.kind).toBe("APPLICATION")
      expect(doc.investments?.[1]?.kind).toBe("REDEMPTION")
      expect(doc.investments?.[2]?.kind).toBe("EARNING")
      expect(doc.investments?.[2]?.amount).toBe("10.00")
    })
  })

  describe("Santander Investment", () => {
    it("parses multiple columns for single date", async () => {
      const source = pdfSource([
        "AGENCIA: 1234 CONTA: 56789-0",
        "10/12/2025 CDB DI 100,00 0,00 0,00 0,00 0,00 50,00 10,00 90,00",
      ])
      const doc = await santanderInvestmentAdapter.parse(source)
      expect(doc.investments).toHaveLength(3)
      expect(doc.investments?.[0]?.kind).toBe("APPLICATION")
      expect(doc.investments?.[0]?.amount).toBe("100.00")
      expect(doc.investments?.[1]?.kind).toBe("REDEMPTION")
      expect(doc.investments?.[1]?.amount).toBe("50.00")
      expect(doc.investments?.[2]?.kind).toBe("EARNING")
      expect(doc.investments?.[2]?.amount).toBe("10.00")
    })
  })

  describe("Sofisa Position", () => {
    it("parses CDB positions", async () => {
      const source = pdfSource([
        "AGENCIA: 1234 CONTA: 56789-0",
        "CDB PREFIXADO 10.000,00",
        "CDB POS-FIXADO 5.000,00",
      ])
      const doc = await sofisaPositionAdapter.parse(source)
      expect(doc.investments).toHaveLength(2)
      expect(doc.investments?.[0]?.kind).toBe("POSITION")
      expect(doc.investments?.[0]?.amount).toBe("10000.00")
      expect(doc.investments?.[1]?.kind).toBe("POSITION")
      expect(doc.investments?.[1]?.amount).toBe("5000.00")
      expect(doc.issues[0]?.code).toBe("POSICAO_INVESTIMENTO_INFORMATIVA")
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
