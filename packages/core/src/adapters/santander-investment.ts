/**
 * Santander Investimentos — PDF Adapter V2
 * Family: SANTANDER_IBE_INVEST
 */

import { parseMoney, money, parseDate } from "../normalization.js"
import type { StatementSourceAdapter, ExtractedStatementSource, CanonicalStatementDocument, StatementSourceDetection, StatementSourceValidation, CanonicalInvestmentEntry } from "../statement-sources.js"
import { createSourceProvenance } from "../statement-sources.js"

const POSITIVE_SIGNATURES = ["EXTRATO DE MOVIMENTO E POSICAO"]
const NEGATIVE_SIGNATURES: string[] = []
const BANK_CODE = "033"

export const santanderInvestmentAdapter: StatementSourceAdapter<"PDF"> = {
  adapterId: "SANTANDER_IBE_INVEST",
  adapterVersion: "2",
  format: "PDF",
  institutionCode: BANK_CODE,
  documentType: "INVESTMENT_ACTIVITY",
  layoutFamily: "SANTANDER_IBE_INVEST",

  detect(source: ExtractedStatementSource & { format: "PDF" }): StatementSourceDetection {
    const allText = (source.pages ?? []).map((p) => p.text).join("\n")
    const upper = normalizeAscii(allText).toUpperCase()
    const positiveMatches = POSITIVE_SIGNATURES.filter((sig) => upper.includes(sig))
    const negativeMatches = NEGATIVE_SIGNATURES.filter((sig) => upper.includes(sig))
    const matched = positiveMatches.length === POSITIVE_SIGNATURES.length && negativeMatches.length === 0
    return {
      matched,
      score: matched ? 100 : positiveMatches.length * 20,
      evidenceCodes: positiveMatches.map((sig) => `SIGNATURE:${sig}`),
    }
  },

  parse(source: ExtractedStatementSource & { format: "PDF" }): CanonicalStatementDocument {
    const pages = source.pages ?? []
    const allText = pages.map((p) => p.text).join("\n")

    // Extract identity
    const identityMatch = /AGENCIA\s*:\s*([0-9]+)\s+CONTA\s*:\s*([0-9-]+)/i.exec(normalizeAscii(allText))
    const agency = identityMatch?.[1]?.replace(/\D/g, "") ?? ""
    const account = identityMatch?.[2]?.replace(/\D/g, "") ?? ""

    const investments: CanonicalInvestmentEntry[] = []
    let txIndex = 0

    for (const page of pages) {
      const lines = splitLines(page.text)
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!
        const match = /^(\d{2}\/\d{2}\/\d{4})\s+(.+)$/.exec(line)
        if (!match) continue

        const values = match[2]!.match(/-?[\d.]+,\d{2}/g) ?? []
        if (values.length < 7) continue

        const date = match[1]!
        
        if (!isZero(values[0]!)) {
          txIndex++
          investments.push({
            investmentId: `inv-${txIndex}`,
            postingDate: parseDate(date),
            amount: money(parseMoney(values[0]!)),
            kind: "APPLICATION",
            description: "Aplicação automática",
            provenance: createSourceProvenance({
              sourceId: source.sourceId,
              format: "PDF",
              adapterId: "SANTANDER_IBE_INVEST",
              adapterVersion: "2",
              rawHash: source.sha256,
              extractionMethod: page.method === "OCR" ? "OCR" : "TEXT",
              page: page.page,
            }),
          })
        }
        
        if (!isZero(values[5]!)) {
          txIndex++
          investments.push({
            investmentId: `inv-${txIndex}`,
            postingDate: parseDate(date),
            amount: money(parseMoney(values[5]!)),
            kind: "REDEMPTION",
            description: "Resgate automático",
            provenance: createSourceProvenance({
              sourceId: source.sourceId,
              format: "PDF",
              adapterId: "SANTANDER_IBE_INVEST",
              adapterVersion: "2",
              rawHash: source.sha256,
              extractionMethod: page.method === "OCR" ? "OCR" : "TEXT",
              page: page.page,
            }),
          })
        }

        if (!isZero(values[6]!)) {
          txIndex++
          investments.push({
            investmentId: `inv-${txIndex}`,
            postingDate: parseDate(date),
            amount: money(parseMoney(values[6]!)),
            kind: "EARNING",
            description: "Rendimento pago",
            provenance: createSourceProvenance({
              sourceId: source.sourceId,
              format: "PDF",
              adapterId: "SANTANDER_IBE_INVEST",
              adapterVersion: "2",
              rawHash: source.sha256,
              extractionMethod: page.method === "OCR" ? "OCR" : "TEXT",
              page: page.page,
            }),
          })
        }
      }
    }

    const txDates = investments.map((tx) => tx.postingDate!)
    const startDate = txDates.length ? txDates.sort()[0]! : undefined
    const endDate = txDates.length ? txDates.sort().at(-1)! : undefined

    return {
      sourceId: source.sourceId,
      format: "PDF",
      institutionCode: BANK_CODE,
      documentType: "INVESTMENT_ACTIVITY",
      layoutFamily: "SANTANDER_IBE_INVEST",
      adapterId: "SANTANDER_IBE_INVEST",
      adapterVersion: "2",
      identity: {
        bankCode: BANK_CODE,
        bankName: "SANTANDER",
        ...(agency ? { agency: { raw: agency, normalized: agency } } : {}),
        ...(account ? { account: { raw: account, normalized: account } } : {}),
      },
      ...(startDate && endDate ? { period: { start: startDate, end: endDate } } : {}),
      transactions: [],
      investments,
      issues: [
        {
          severity: "WARNING",
          code: "MOVIMENTOS_INVESTIMENTO_INFORMATIVOS",
          message: "Os movimentos de investimento são informativos e não serão conciliados com o razão.",
        }
      ],
    }
  },

  validate(document: CanonicalStatementDocument): StatementSourceValidation {
    const issues = [...document.issues]

    if (!document.identity.bankName) {
      issues.push({ severity: "ERROR", code: "BANK_IDENTITY_MISSING", message: "Identidade bancária não detectada." })
    }

    return { accepted: issues.every((i) => i.severity !== "ERROR"), issues }
  },
}

function normalizeAscii(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/(?<=\d)\s+([.,])\s*(?=\d)/g, "$1")
        .replace(/(?<=\d[.,])\s+(?=\d)/g, ""),
    )
    .filter(Boolean)
}

function isZero(value: string): boolean {
  return parseMoney(value).isZero()
}
