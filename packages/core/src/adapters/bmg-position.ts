import { money, parseDate, parseMoney } from "../normalization.js"
import {
  createSourceProvenance,
  type CanonicalInvestmentEntry,
  type CanonicalStatementDocument,
  type ExtractedStatementSource,
  type StatementSourceAdapter,
  type StatementSourceDetection,
  type StatementSourceValidation,
} from "../statement-sources.js"

const BANK_CODE = "318"
const BANK_SIGNATURES = ["BANCO BMG", "INTERNET BANKING - BMG"]
const LAYOUT_SIGNATURES = ["POSICAO E PERFORMANCE", "CONFIRA SUA POSICAO DE INVESTIMENTOS"]

export const bmgPositionAdapter: StatementSourceAdapter<"PDF"> = {
  adapterId: "BMG_POSICAO_RENDIMENTO",
  adapterVersion: "1",
  format: "PDF",
  institutionCode: BANK_CODE,
  documentType: "INVESTMENT_POSITION",
  layoutFamily: "BMG_POSICAO_RENDIMENTO",

  detect(source: ExtractedStatementSource & { format: "PDF" }): StatementSourceDetection {
    const upper = normalizeAscii(joinPages(source)).toUpperCase()
    const bankMatches = BANK_SIGNATURES.filter((signature) => upper.includes(signature))
    const layoutMatches = LAYOUT_SIGNATURES.filter((signature) => upper.includes(signature))
    const matched = bankMatches.length > 0 && layoutMatches.length > 0

    return {
      matched,
      score: matched ? 100 : (bankMatches.length + layoutMatches.length) * 20,
      evidenceCodes: [...bankMatches, ...layoutMatches].map((signature) => `SIGNATURE:${signature}`),
    }
  },

  parse(source: ExtractedStatementSource & { format: "PDF" }): CanonicalStatementDocument {
    const allText = joinPages(source)
    const normalizedText = normalizeAscii(allText)
    const positionDateMatch = /\bEXTRATO\s+(\d{2}\/\d{2}\/\d{4})\b/i.exec(normalizedText)
    const positionDate = positionDateMatch?.[1] ? parseDate(positionDateMatch[1]) : undefined
    const closingBalance = /SALDO\s+LIQUIDO\s+R\$\s*([\d.,]+\d{2})/i.exec(normalizedText)?.[1]
    const investments: CanonicalInvestmentEntry[] = []

    for (const page of source.pages ?? []) {
      for (const line of splitLines(page.text)) {
        if (!/^(?:CDB|LCI|LCA)\b/i.test(line)) continue

        const amounts = line.match(/(?:\d{1,3}(?:[.,]\d{3})+|\d+)[.,]\d{2}/g) ?? []
        const positionAmount = amounts.at(-1)
        if (!positionAmount || parseMoney(positionAmount).isZero()) continue

        investments.push({
          investmentId: `inv-${investments.length + 1}`,
          ...(positionDate ? { postingDate: positionDate } : {}),
          amount: money(parseMoney(positionAmount)),
          kind: "POSITION",
          description: investmentDescription(line),
          provenance: createSourceProvenance({
            sourceId: source.sourceId,
            format: "PDF",
            adapterId: "BMG_POSICAO_RENDIMENTO",
            adapterVersion: "1",
            rawHash: source.sha256,
            extractionMethod: page.method,
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
      layoutFamily: "BMG_POSICAO_RENDIMENTO",
      adapterId: "BMG_POSICAO_RENDIMENTO",
      adapterVersion: "1",
      identity: { bankCode: BANK_CODE, bankName: "BMG" },
      ...(positionDate ? { period: { start: positionDate, end: positionDate } } : {}),
      ...(closingBalance ? { closingBalance } : {}),
      transactions: [],
      investments,
      issues: [{
        severity: "WARNING",
        code: "POSICAO_INVESTIMENTO_INFORMATIVA",
        message: "A posição de investimento é informativa e não será conciliada com o razão.",
      }],
    }
  },

  validate(document: CanonicalStatementDocument): StatementSourceValidation {
    const issues = [...document.issues]

    if (!document.investments?.length) {
      issues.push({
        severity: "ERROR",
        code: "INVESTMENT_POSITIONS_NOT_EXTRACTED",
        message: "Nenhuma posição de investimento foi extraída do documento reconhecido.",
      })
    }

    return { accepted: issues.every((issue) => issue.severity !== "ERROR"), issues }
  },
}

function joinPages(source: ExtractedStatementSource): string {
  return (source.pages ?? []).map((page) => page.text).join("\n")
}

function normalizeAscii(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function investmentDescription(line: string): string {
  const beforeRate = /^(.*?)\s+\d+(?:[.,]\d+)%/i.exec(line)?.[1]
  return (beforeRate ?? line.split(/\s+R\$/i)[0] ?? line).trim().replace(/\s+/g, " ")
}
