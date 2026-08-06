/**
 * BRB Conta-Corrente — PDF Adapter V2
 * Family: BRB_CC_DETALHADO
 */

import { parseMoney, money, parseDate } from "../normalization.js"
import type { StatementSourceAdapter, ExtractedStatementSource, CanonicalStatementDocument, StatementSourceDetection, StatementSourceValidation, CanonicalBankTransaction } from "../statement-sources.js"
import { createSourceProvenance } from "../statement-sources.js"

function normalizeAscii(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}


const POSITIVE_SIGNATURES = ["DADOS DA CONTA ORIGEM", "TIPO DE EXTRATO"]
const NEGATIVE_SIGNATURES: string[] = []
const BANK_CODE = "070"

export const brbCurrentAccountAdapter: StatementSourceAdapter<"PDF"> = {
  adapterId: "BRB_CC_DETALHADO",
  adapterVersion: "2",
  format: "PDF",
  institutionCode: BANK_CODE,
  documentType: "CURRENT_ACCOUNT",
  layoutFamily: "BRB_CC_DETALHADO",

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
    const identityMatch = /NUMERO\s+DA\s+CONTA\s*\n?\s*([0-9.\-]+)/i.exec(normalizeAscii(allText))
    const account = identityMatch?.[1]?.replace(/\D/g, "") ?? ""

    const transactions: CanonicalBankTransaction[] = []
    let txIndex = 0

    for (const page of pages) {
      const lines = splitLines(page.text)
      for (let index = 0; index < lines.length; index += 1) {
        // Single-line format
        const singleLine = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(\d{6,})\s+([\d.]+,\d{2})\s*([+-])\s+([\d.]+,\d{2})$/.exec(lines[index]!)
        if (singleLine) {
          const history = singleLine[2]!.trim()
          if (!/\bSALDO\b/i.test(history)) {
            txIndex++
            const isNegative = singleLine[5] === "-"
            const rawAmount = `${isNegative ? "-" : ""}${singleLine[4]!}`
            const amount = parseMoney(rawAmount)

            transactions.push({
              transactionId: `tx-${txIndex}`,
              postingDate: parseDate(singleLine[1]!),
              amount: money(amount),
              direction: amount.isNegative() ? "DEBIT" : "CREDIT",
              description: history,
              documentNumber: singleLine[3]!,
              runningBalance: money(parseMoney(singleLine[6]!)),
              provenance: createSourceProvenance({
                sourceId: source.sourceId,
                format: "PDF",
                adapterId: "BRB_CC_DETALHADO",
                adapterVersion: "2",
                rawHash: source.sha256,
                extractionMethod: page.method === "OCR" ? "OCR" : "TEXT",
                page: page.page,
              }),
            })
          }
          continue
        }

        // Multi-line format
        const dateMatch = /^(\d{2}\/\d{2}\/\d{4})$/.exec(lines[index]!)
        if (!dateMatch) continue

        const nextDate = lines.findIndex((line, offset) => offset > index && /^\d{2}\/\d{2}\/\d{4}$/.test(line))
        const end = nextDate < 0 ? lines.length : nextDate
        const block = lines.slice(index + 1, end)

        const documentIndex = block.findIndex((line) => /^\d{6,}$/.test(line))
        if (documentIndex < 0) continue

        const valueIndex = block.findIndex((line, offset) => offset > documentIndex && /^[\d.]+,\d{2}$/.test(line))
        if (valueIndex < 0) continue

        const sign = block[valueIndex + 1] === "-" ? "-" : ""
        const rawAmount = `${sign}${block[valueIndex]!}`
        const amount = parseMoney(rawAmount)
        const runningBalanceStr = /^[-]?[\d.]+,\d{2}$/.test(block[valueIndex + 2] ?? "") ? block[valueIndex + 2] : undefined
        const history = block.slice(0, documentIndex).filter((line) => !/^\d{4}$/.test(line)).join(" ")

        if (!history || /SALDO/i.test(history)) continue

        txIndex++
        transactions.push({
          transactionId: `tx-${txIndex}`,
          postingDate: parseDate(dateMatch[1]!),
          amount: money(amount),
          direction: amount.isNegative() ? "DEBIT" : "CREDIT",
          description: history,
          documentNumber: block[documentIndex]!,
          ...(runningBalanceStr ? { runningBalance: money(parseMoney(runningBalanceStr)) } : {}),
          provenance: createSourceProvenance({
            sourceId: source.sourceId,
            format: "PDF",
            adapterId: "BRB_CC_DETALHADO",
            adapterVersion: "2",
            rawHash: source.sha256,
            extractionMethod: page.method === "OCR" ? "OCR" : "TEXT",
            page: page.page,
          }),
        })
      }
    }

    // Detect explicit no-movements
    const normalizedText = normalizeAscii(allText).toUpperCase()
    const declaresNoMovements =
      normalizedText.includes("SEM MOVIMENT") ||
      normalizedText.includes("NAO HOUVE LANC") ||
      normalizedText.includes("SEM TRANSAC")

    const openingBalance = transactions.length && transactions[0]!.runningBalance
      ? money(parseMoney(transactions[0]!.runningBalance).minus(parseMoney(transactions[0]!.amount)))
      : undefined
    const closingBalance = transactions.length
      ? transactions.at(-1)!.runningBalance
      : undefined

    const txDates = transactions.map((tx) => tx.postingDate)
    const startDate = txDates.length ? txDates.sort()[0]! : undefined
    const endDate = txDates.length ? txDates.sort().at(-1)! : undefined

    return {
      sourceId: source.sourceId,
      format: "PDF",
      institutionCode: BANK_CODE,
      documentType: "CURRENT_ACCOUNT",
      layoutFamily: "BRB_CC_DETALHADO",
      adapterId: "BRB_CC_DETALHADO",
      adapterVersion: "2",
      identity: {
        bankCode: BANK_CODE,
        bankName: "BRB",
        ...(account ? { account: { raw: account, normalized: account.replace(/\D/g, "") } } : {}),
      },
      ...(startDate && endDate ? { period: { start: startDate, end: endDate } } : {}),
      transactions,
      ...(declaresNoMovements && transactions.length === 0 ? { declaresNoMovements: true } : {}),
      ...(openingBalance !== undefined ? { openingBalance } : {}),
      ...(closingBalance !== undefined ? { closingBalance } : {}),
      issues: [],
    }
  },

  validate(document: CanonicalStatementDocument): StatementSourceValidation {
    const issues: Array<{ severity: "WARNING" | "ERROR"; code: string; message: string }> = []

    if (!document.identity.bankName) {
      issues.push({ severity: "ERROR", code: "BANK_IDENTITY_MISSING", message: "Identidade bancária não detectada." })
    }
    if (document.transactions.length === 0 && !document.declaresNoMovements) {
      issues.push({ severity: "ERROR", code: "STATEMENT_MOVEMENTS_NOT_EXTRACTED", message: "Nenhum movimento foi extraído do extrato." })
    }

    return { accepted: issues.every((i) => i.severity !== "ERROR"), issues }
  },
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
