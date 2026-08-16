import { describe, expect, it } from "vitest"

import { registeredV2Adapters } from "../../src/adapters/index.js"
import { PDF_CORPUS_SUPPORT_MATRIX } from "../../src/corpus-support-matrix.js"

const EXPECTED_FAMILIES = [
  "ABC_CC_EXTRATO_DETALHADO",
  "ABC_CONTA_VINCULADA",
  "BB_CC_CONSULTAS",
  "BB_RENDE_FACIL_RESUMO",
  "BMG_CC_WEB",
  "BMG_POSICAO_RENDIMENTO",
  "BMP_CC_EXTRATO",
] as const

describe("Gate técnico do Lote 2", () => {
  it("mantém os 12 documentos distribuídos pelas sete famílias observadas", () => {
    const lot = PDF_CORPUS_SUPPORT_MATRIX.filter((entry) => entry.lot === 2)

    expect(lot).toHaveLength(7)
    expect(lot.reduce((total, entry) => total + entry.quantity, 0)).toBe(12)
    expect(lot.map((entry) => entry.layoutFamily)).toEqual(expect.arrayContaining([...EXPECTED_FAMILIES]))
  })

  it("possui um adapter registrado para cada família do Lote 2", () => {
    const registeredFamilies = registeredV2Adapters.map((adapter) => adapter.layoutFamily)

    for (const family of EXPECTED_FAMILIES) expect(registeredFamilies).toContain(family)
  })

  it("não declara família do Lote 2 como homologada ou ainda sem adapter", () => {
    const lot = PDF_CORPUS_SUPPORT_MATRIX.filter((entry) => entry.lot === 2)

    expect(lot.every((entry) => entry.currentStatus !== "UNSUPPORTED")).toBe(true)
    expect(lot.every((entry) => entry.currentStatus === "PARTIAL_ADAPTER" || entry.currentStatus === "AWAITING_ORACLE")).toBe(true)
  })

  it("mantém Rende Fácil e posição BMG fora da conciliação automática", () => {
    const informational = PDF_CORPUS_SUPPORT_MATRIX.filter(
      (entry) => entry.lot === 2 && entry.documentType !== "CURRENT_ACCOUNT",
    )

    expect(informational.map((entry) => entry.layoutFamily)).toEqual([
      "BB_RENDE_FACIL_RESUMO",
      "BMG_POSICAO_RENDIMENTO",
    ])
    expect(informational.every((entry) => !entry.reconciliationEligible)).toBe(true)
  })
})
