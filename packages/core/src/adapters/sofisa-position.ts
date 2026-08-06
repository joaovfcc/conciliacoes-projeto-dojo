/**
 * Sofisa Investimentos (Posição) — PDF Adapter V2
 * Family: SOFISA_NET_POSICAO
 */

import { parseMoney, money } from "../normalization.js"
import type { StatementSourceAdapter, ExtractedStatementSource, CanonicalStatementDocument, StatementSourceDetection, StatementSourceValidation, CanonicalInvestmentEntry } from "../statement-sources.js"
import { createSourceProvenance } from "../statement-sources.js"

const POSITIVE_SIGNATURES = ["POSICAO DE INVESTIMENTOS"]
const NEGATIVE_SIGNATURES: string[] = []
const BANK_CODE = "633"

export const sofisaPositionAdapter: StatementSourceAdapter<"PDF"> = {
  adapterId: "SOFISA_NET_POSICAO",
  adapterVersion: "2",
  format: "PDF",
  institutionCode: BANK_CODE,
  documentType: "INVESTMENT_POSITION",
  layoutFamily: "SOFISA_NET_POSICAO",

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
    const finalBalanceMatch = /VALOR\s+LIQUIDO\s+TOTAL\s+R\$\s*([\d.]+,\d{2})/i.exec(normalizeAscii(allText))

    const investments: CanonicalInvestmentEntry[] = []
    let txIndex = 0

    for (const page of pages) {
      const lines = splitLines(page.text)
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!
        const match = /^CDB\s.*?([\d.]+,\d{2})$/.exec(line)
        if (!match) continue

        const amountStr = match[1]!
        if (isZero(amountStr)) continue

        txIndex++
        investments.push({
          investmentId: `inv-${txIndex}`,
          amount: money(parseMoney(amountStr)),
          kind: "POSITION",
          description: "CDB",
          provenance: createSourceProvenance({
            sourceId: source.sourceId,
            format: "PDF",
            adapterId: "SOFISA_NET_POSICAO",
            adapterVersion: "2",
            rawHash: source.sha256,
            extractionMethod: page.method === "OCR" ? "OCR" : "TEXT",
            page: page.page,
          }),
        })
      }
    }

    return {
      sourceId: source.sourceId,
      format: "PDF",
      institutionCode: BANK_CODE,
      documentType: "INVESTMENT_POSITION",
      layoutFamily: "SOFISA_NET_POSICAO",
      adapterId: "SOFISA_NET_POSICAO",
      adapterVersion: "2",
      identity: {
        bankCode: BANK_CODE,
        bankName: "SOFISA",
        ...(agency ? { agency: { raw: agency, normalized: agency } } : {}),
        ...(account ? { account: { raw: account, normalized: account } } : {}),
      },
      ...(finalBalanceMatch ? { closingBalance: finalBalanceMatch[1]! } : {}),
      transactions: [],
      investments,
      issues: [
        {
          severity: "WARNING",
          code: "POSICAO_INVESTIMENTO_INFORMATIVA",
          message: "A posição de investimento é informativa e não será conciliada com o razão.",
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
