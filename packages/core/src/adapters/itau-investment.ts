/**
 * Itaú Investimentos — PDF Adapter V2
 * Family: ITAU_APLIC_AUT_MAIS
 */

import { parseMoney, money, parseDate } from "../normalization.js"
import type { StatementSourceAdapter, ExtractedStatementSource, CanonicalStatementDocument, StatementSourceDetection, StatementSourceValidation, CanonicalInvestmentEntry } from "../statement-sources.js"
import { createSourceProvenance } from "../statement-sources.js"

const POSITIVE_SIGNATURES = ["ITAU", "APLIC AUT MAIS", "EXTRATO DETALHADO DE MOVIMENTACAO"]
const NEGATIVE_SIGNATURES = ["BANCO SAFRA"]
const BANK_CODE = "341"

export const itauInvestmentAdapter: StatementSourceAdapter<"PDF"> = {
  adapterId: "ITAU_APLIC_AUT_MAIS",
  adapterVersion: "2",
  format: "PDF",
  institutionCode: BANK_CODE,
  documentType: "INVESTMENT_ACTIVITY",
  layoutFamily: "ITAU_APLIC_AUT_MAIS",

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
    const identityMatch = /(?:AG[EE]NCIA\s*:?\s*|AG[EE]NCIA\/CONTA\s*:?\s*)([0-9]+)(?:\s*-|.*?CONTA\s*:?\s*)([0-9-]+)/is.exec(normalizeAscii(allText))
    const agency = identityMatch?.[1]?.replace(/\D/g, "") ?? ""
    const account = identityMatch?.[2]?.replace(/\D/g, "") ?? ""

    const investments: CanonicalInvestmentEntry[] = []
    let txIndex = 0
    let lastSeenDate: string | undefined

    for (const page of pages) {
      const lines = splitLines(page.text)
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!
        
        const dateMatch = /^(\d{2}\/\d{2}\/\d{4})/.exec(line)
        if (dateMatch) {
          lastSeenDate = dateMatch[1]
        }
        
        const normLine = normalizeAscii(line)
        const isRedemption = /RESG|VENC/i.test(normLine) || (/^\d{2}\/\d{2}\/\d{4}\s+R/i.test(line) && !/REND|RENTAB/i.test(normLine))

        const classify = isRedemption 
          ? "REDEMPTION" 
          : /REND|RENTAB/i.test(normLine) 
            ? "EARNING" 
            : /^\d{2}\/\d{2}\/\d{4}\s+A/i.test(line) || /APLIC/i.test(normLine) 
              ? "APPLICATION" 
              : undefined

        const date = dateMatch ? dateMatch[1] : lastSeenDate
        const values = line.match(/-?[\d.]+,\d{2}/g) ?? []

        if (!classify || !date || !values.length) continue

        txIndex++
        investments.push({
          investmentId: `inv-${txIndex}`,
          postingDate: parseDate(date),
          amount: money(parseMoney(values[0]!)),
          kind: classify,
          description: classify === "APPLICATION" ? "Aplicação" : classify === "REDEMPTION" ? "Resgate/Vencimento" : "Rendimento",
          provenance: createSourceProvenance({
            sourceId: source.sourceId,
            format: "PDF",
            adapterId: "ITAU_APLIC_AUT_MAIS",
            adapterVersion: "2",
            rawHash: source.sha256,
            extractionMethod: page.method === "OCR" ? "OCR" : "TEXT",
            page: page.page,
          }),
        })
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
      layoutFamily: "ITAU_APLIC_AUT_MAIS",
      adapterId: "ITAU_APLIC_AUT_MAIS",
      adapterVersion: "2",
      identity: {
        bankCode: BANK_CODE,
        bankName: "ITAU",
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
