import { describe, expect, it } from "vitest"

import { v2AdapterRegistry } from "../../src/adapters/index.js"
import { type ExtractedStatementSource } from "../../src/statement-sources.js"

const sha256 = "d".repeat(64)

describe("Gate RC Lote 1", () => {
  it("tem 9 adapters registrados no registry V2", () => {
    // 5 CC + 4 Investments
    const adapters = (v2AdapterRegistry as any).adapters
    expect(adapters).toHaveLength(9)

    const expectedFamilies = [
      "BRADESCO_NET_EMPRESA_CC",
      "BRB_CC_DETALHADO",
      "ITAU_EMPRESAS_CC",
      "SANTANDER_IBE_CC",
      "SOFISA_NET_CC",
      "BRADESCO_NET_EMPRESA_INVEST",
      "ITAU_APLIC_AUT_MAIS",
      "SANTANDER_IBE_INVEST",
      "SOFISA_NET_POSICAO",
    ]

    const actualFamilies = adapters.map((a: any) => a.layoutFamily)
    for (const family of expectedFamilies) {
      expect(actualFamilies).toContain(family)
    }
  })

  it("nenhum adapter gera falsos positivos com documento vazio ou lixo", () => {
    const source = pdfSource(["LIXO ALEATORIO\nCOMPROVANTE DE TRANSFERENCIA\n"])
    const selection = v2AdapterRegistry.select(source)

    expect(selection.status).toBe("UNSUPPORTED")
  })

  it("investimentos geram warning informativo e nao possuem transacoes", async () => {
    const source = pdfSource([
      "ITAU\nAPLIC AUT MAIS\nEXTRATO DETALHADO DE MOVIMENTACAO\nAGENCIA: 1234 CONTA: 56789-0",
      "10/12/2025 APLICACAO 100,00",
    ])
    const selection = v2AdapterRegistry.select(source)
    expect(selection.status).toBe("SELECTED")

    if (selection.status === "SELECTED") {
      const doc = await selection.adapter.parse(source)
      expect(doc.documentType).toBe("INVESTMENT_ACTIVITY")
      expect(doc.transactions).toHaveLength(0)
      expect(doc.investments).toHaveLength(1)
      expect(doc.issues).toContainEqual(expect.objectContaining({ 
        code: "MOVIMENTOS_INVESTIMENTO_INFORMATIVOS", 
        severity: "WARNING" 
      }))
    }
  })

  it("detecção positiva funciona com assinaturas reais", () => {
    const bradesco = pdfSource(["EXTRATO MENSAL / POR PERIODO\nEXTRATO DE:"])
    expect(v2AdapterRegistry.select(bradesco).status).toBe("SELECTED")

    const brb = pdfSource(["DADOS DA CONTA ORIGEM\nTIPO DE EXTRATO"])
    expect(v2AdapterRegistry.select(brb).status).toBe("SELECTED")

    const itau = pdfSource(["EXTRATO DE CONTA CORRENTE\nSALDO RESUMIDO"])
    expect(v2AdapterRegistry.select(itau).status).toBe("SELECTED")

    const santander = pdfSource(["INTERNET BANKING EMPRESARIAL\nCONTA CORRENTE"])
    expect(v2AdapterRegistry.select(santander).status).toBe("SELECTED")

    const sofisa = pdfSource(["EXTRATO 45 DIAS\nENTRADAS/SAIDAS"])
    expect(v2AdapterRegistry.select(sofisa).status).toBe("SELECTED")
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
