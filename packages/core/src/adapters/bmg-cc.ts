import { money, parseDate, parseMoney } from "../normalization.js"
import {
  createSourceProvenance,
  type CanonicalBankTransaction,
  type CanonicalStatementDocument,
  type ExtractedPdfPage,
  type ExtractedStatementSource,
  type StatementSourceAdapter,
  type StatementSourceDetection,
  type StatementSourceValidation,
} from "../statement-sources.js"
import type { ImportIssue } from "../types.js"

const BANK_CODE = "318"
const BANK_SIGNATURES = ["BANCO BMG", "INTERNET BANKING - BMG"]
const LAYOUT_SIGNATURE = "EXTRATO DA CONTA"

type TransactionDraft = {
  date: string
  description: string[]
  direction: "DEBIT" | "CREDIT"
  amount: string
  page: ExtractedPdfPage
}

export const bmgCurrentAccountAdapter: StatementSourceAdapter<"PDF"> = {
  adapterId: "BMG_CC_WEB",
  adapterVersion: "1",
  format: "PDF",
  institutionCode: BANK_CODE,
  documentType: "CURRENT_ACCOUNT",
  layoutFamily: "BMG_CC_WEB",

  detect(source: ExtractedStatementSource & { format: "PDF" }): StatementSourceDetection {
    const upper = normalizeAscii(joinPages(source)).toUpperCase()
    const bankMatches = BANK_SIGNATURES.filter((signature) => upper.includes(signature))
    const layoutMatched = upper.includes(LAYOUT_SIGNATURE)
    const matched = bankMatches.length > 0 && layoutMatched

    return {
      matched,
      score: matched ? 100 : bankMatches.length * 20 + (layoutMatched ? 20 : 0),
      evidenceCodes: [
        ...bankMatches.map((signature) => `SIGNATURE:${signature}`),
        ...(layoutMatched ? [`SIGNATURE:${LAYOUT_SIGNATURE}`] : []),
      ],
    }
  },

  parse(source: ExtractedStatementSource & { format: "PDF" }): CanonicalStatementDocument {
    const normalizedText = normalizeAscii(joinPages(source))
    const identityMatch = /AGENCIA\s*:\s*(\d+)\s+CONTA\s*:\s*([\d-]+)/i.exec(normalizedText)
    const closingControl = extractClosingControl(normalizedText)
    const period = closingControl ? monthPeriod(closingControl.month, closingControl.year) : undefined
    const closingBalance = closingControl?.balance
    const transactions: CanonicalBankTransaction[] = []
    const summaryBalances: string[] = []
    const issues: ImportIssue[] = []
    let pending: TransactionDraft | undefined

    const flush = (): void => {
      if (!pending) return
      const absoluteAmount = parseMoney(pending.amount).abs()
      const amount = pending.direction === "DEBIT" ? absoluteAmount.negated() : absoluteAmount

      transactions.push({
        transactionId: `tx-${transactions.length + 1}`,
        postingDate: parseDate(pending.date),
        amount: money(amount),
        direction: pending.direction,
        description: pending.description.join(" ").replace(/\s+/g, " ").trim(),
        provenance: createSourceProvenance({
          sourceId: source.sourceId,
          format: "PDF",
          adapterId: "BMG_CC_WEB",
          adapterVersion: "1",
          rawHash: source.sha256,
          extractionMethod: pending.page.method,
          page: pending.page.page,
        }),
      })
      pending = undefined
    }

    for (const page of source.pages ?? []) {
      for (const rawLine of splitLines(page.text)) {
        const line = normalizeAscii(rawLine)
        const movement = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(CREDITO|DEBITO)\s+(-?\s*R\$\s*[\d.,]+\d{2})$/i.exec(line)
        if (movement?.[1] && movement[2] && movement[3] && movement[4]) {
          flush()
          pending = {
            date: movement[1],
            description: [movement[2].trim()],
            direction: movement[3].toUpperCase() === "DEBITO" ? "DEBIT" : "CREDIT",
            amount: movement[4],
            page,
          }
          continue
        }

        const summary = /^(\d{2}\/\d{2}\/\d{4})\s+(-?\s*R\$\s*[\d.,]+\d{2})$/i.exec(line)
        if (summary?.[2]) {
          flush()
          summaryBalances.push(money(parseMoney(summary[2])))
          continue
        }

        if (/^LANCAMENTO$/i.test(line)) {
          flush()
          continue
        }
        if (/^(?:ATENDIMENTO|CENTRAL DE RELACIONAMENTO|INFORMACOES OU RECLAMACOES|OUVIDORIA)\b/i.test(line)) {
          flush()
          continue
        }
        if (pending && isDescriptionContinuation(line)) pending.description.push(line.trim())
      }
    }
    flush()

    const normalizedClosing = closingBalance ? money(parseMoney(closingBalance)) : undefined
    const finalSummaryBalance = summaryBalances.at(-1)
    if (normalizedClosing && finalSummaryBalance && normalizedClosing !== finalSummaryBalance) {
      issues.push({
        severity: "ERROR",
        code: "BALANCE_INTEGRITY_FAILED",
        message: "Os controles de saldo final do extrato BMG são divergentes.",
      })
    }

    const agency = identityMatch?.[1]?.replace(/\D/g, "")
    const account = identityMatch?.[2]?.replace(/\D/g, "")
    const declaresNoMovements = transactions.length === 0
      && Boolean(agency && account && period && normalizedClosing && finalSummaryBalance)

    return {
      sourceId: source.sourceId,
      format: "PDF",
      institutionCode: BANK_CODE,
      documentType: "CURRENT_ACCOUNT",
      layoutFamily: "BMG_CC_WEB",
      adapterId: "BMG_CC_WEB",
      adapterVersion: "1",
      identity: {
        bankCode: BANK_CODE,
        bankName: "BMG",
        ...(agency ? { agency: { raw: agency, normalized: agency } } : {}),
        ...(account ? { account: { raw: account, normalized: account } } : {}),
      },
      ...(period ? { period } : {}),
      transactions,
      ...(declaresNoMovements ? { declaresNoMovements: true } : {}),
      ...(closingBalance ? { closingBalance } : {}),
      issues,
    }
  },

  validate(document: CanonicalStatementDocument): StatementSourceValidation {
    const issues = [...document.issues]
    if (!document.identity.agency || !document.identity.account) {
      issues.push({ severity: "ERROR", code: "BANK_IDENTITY_MISSING", message: "Agência ou conta BMG não detectada." })
    }
    if (!document.period) {
      issues.push({ severity: "ERROR", code: "STATEMENT_PERIOD_MISSING", message: "Competência do extrato BMG não detectada." })
    }
    if (!document.closingBalance) {
      issues.push({ severity: "ERROR", code: "CLOSING_BALANCE_MISSING", message: "Saldo final do extrato BMG não detectado." })
    }
    if (document.transactions.length === 0 && !document.declaresNoMovements) {
      issues.push({ severity: "ERROR", code: "STATEMENT_MOVEMENTS_NOT_EXTRACTED", message: "Nenhum movimento foi extraído do extrato BMG." })
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

function monthPeriod(monthText: string, yearText: string): { start: string; end: string } | undefined {
  const month = Number(monthText)
  const year = 2000 + Number(yearText)
  if (!Number.isInteger(month) || month < 1 || month > 12) return undefined
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const monthPart = String(month).padStart(2, "0")
  return {
    start: `${year}-${monthPart}-01`,
    end: `${year}-${monthPart}-${String(lastDay).padStart(2, "0")}`,
  }
}

function isDescriptionContinuation(line: string): boolean {
  return Boolean(line)
    && !/^\d{2}\/\d{2}\/\d{4}\b/.test(line)
    && !/^(?:SALDO|AGENCIA|CONTA|EXTRATO|CABECALHO|SPREAD SISTEMAS)\b/i.test(line)
}

function extractClosingControl(text: string): { month: string; year: string; balance: string } | undefined {
  const trailingAmount = /SALDO\s+TOTAL\s*\(EM\s*(\d{2})\/(\d{2})\)\s*:\s*R\$\s*(-?[\d.,]+\d{2})/i.exec(text)
  if (trailingAmount?.[1] && trailingAmount[2] && trailingAmount[3]) {
    return { month: trailingAmount[1], year: trailingAmount[2], balance: trailingAmount[3] }
  }

  const leadingAmount = /R\$\s*(-?[\d.,]+\d{2})\s+SALDO\s+TOTAL\s*\(EM\s*(\d{2})\/(\d{2})\)\s*:/i.exec(text)
  return leadingAmount?.[1] && leadingAmount[2] && leadingAmount[3]
    ? { month: leadingAmount[2], year: leadingAmount[3], balance: leadingAmount[1] }
    : undefined
}
