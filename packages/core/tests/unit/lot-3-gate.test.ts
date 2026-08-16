import { describe, expect, it } from "vitest"

import { registeredV2Adapters } from "../../src/adapters/index.js"
import { PDF_CORPUS_SUPPORT_MATRIX } from "../../src/corpus-support-matrix.js"

const EXPECTED_FAMILIES = [
  "BOCOM_CC_EMPTY",
  "BOCOM_CC_ANALITICO",
  "CAIXA_CC_EXTRATO_PERIODO",
  "CAIXA_FUNDO_EXTRATO",
  "DAYCOVAL_CC_EXTRATO_DETALHADO",
  "GUANABARA_CC",
  "GUANABARA_CONTA_VINCULADA",
] as const

describe("Gate técnico do Lote 3", () => {
  it("preserva os dez documentos distribuídos pelas sete famílias observadas", () => {
    const lot = PDF_CORPUS_SUPPORT_MATRIX.filter((entry) => entry.lot === 3)

    expect(lot).toHaveLength(7)
    expect(lot.reduce((total, entry) => total + entry.quantity, 0)).toBe(10)
    expect(lot.map((entry) => entry.layoutFamily)).toEqual(expect.arrayContaining([...EXPECTED_FAMILIES]))
  })

  it("registra um adapter para cada família do lote, inclusive a dependente de OCR", () => {
    const registeredFamilies = registeredV2Adapters.map((adapter) => adapter.layoutFamily)

    for (const family of EXPECTED_FAMILIES) expect(registeredFamilies).toContain(family)
  })

  it("não declara suporte homologado nem mantém família textual sem adapter", () => {
    const lot = PDF_CORPUS_SUPPORT_MATRIX.filter((entry) => entry.lot === 3)

    expect(lot.every((entry) => entry.currentStatus !== "UNSUPPORTED")).toBe(true)
    expect(lot.every((entry) => ["PARTIAL_ADAPTER", "AWAITING_ORACLE", "AWAITING_OCR"].includes(entry.currentStatus))).toBe(true)
  })

  it("mantém o fundo Caixa fora da conciliação automática", () => {
    expect(PDF_CORPUS_SUPPORT_MATRIX.find((entry) => entry.layoutFamily === "CAIXA_FUNDO_EXTRATO")).toMatchObject({
      documentType: "FUND_STATEMENT",
      reconciliationEligible: false,
    })
  })
})
