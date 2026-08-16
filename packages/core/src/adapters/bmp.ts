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

const BANK_CODE = "274"
const MONEY = "-?(?:\\d{1,3}(?:\\.\\d{3})*|\\d+),\\d{2}"
const REQUIRED_SIGNATURES = [
  "CPF/CNPJ CPF/CNPJ",
  "AGENCIA AGENCIA",
  "EXTRATO DA CONTA EXTRATO DA CONTA",
  "CREDITO (R$) CREDITO (R$)",
  "DEBITO (R$) DEBITO (R$)",
]

type MovementDraft = {
  postingDate: string
  description: string[]
  amount: string
  direction: "DEBIT" | "CREDIT"
  runningBalance: string
  page: ExtractedPdfPage
}

export const bmpCurrentAccountAdapter: StatementSourceAdapter<"PDF"> = {
  adapterId: "BMP_CC_EXTRATO",
  adapterVersion: "1",
  format: "PDF",
  institutionCode: BANK_CODE,
  documentType: "CURRENT_ACCOUNT",
  layoutFamily: "BMP_CC_EXTRATO",

  detect(source): StatementSourceDetection {
    const upper = normalizeAscii(joinPages(source)).toUpperCase()
    const matches = REQUIRED_SIGNATURES.filter((signature) => upper.includes(signature))
    const matched = matches.length === REQUIRED_SIGNATURES.length
    return {
      matched,
      score: matched ? 100 : matches.length * 15,
      evidenceCodes: matches.map((signature) => `SIGNATURE:${signature}`),
    }
  },

  parse(source): CanonicalStatementDocument {
    const normalizedText = normalizeAscii(joinPages(source))
    const identityMatch = /AGENCIA\s+AGENCIA\s+(\d+)\s*-\s*MATRIZ\s+CONTA\s+CONTA\s+([\d-]+)/i.exec(normalizedText)
    const periodMatch = /PERIODO\s*:\s*PERIODO\s*:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/i.exec(normalizedText)
    const transactions: CanonicalBankTransaction[] = []
    const issues: ImportIssue[] = []
    let openingBalance: string | undefined
    let closingBalance: string | undefined
    let draft: MovementDraft | undefined

    const flush = (): void => {
      if (!draft) return
      transactions.push({
        transactionId: `tx-${transactions.length + 1}`,
        postingDate: parseDate(draft.postingDate),
        amount: draft.amount,
        direction: draft.direction,
        description: draft.description.join(" ").replace(/\s+/g, " ").trim(),
        runningBalance: draft.runningBalance,
        provenance: createSourceProvenance({
          sourceId: source.sourceId,
          format: "PDF",
          adapterId: "BMP_CC_EXTRATO",
          adapterVersion: "1",
          rawHash: source.sha256,
          extractionMethod: draft.page.method,
          page: draft.page.page,
        }),
      })
      draft = undefined
    }

    for (const page of source.pages ?? []) {
      for (const rawLine of splitLines(page.text)) {
        const line = normalizeAscii(rawLine)
        const opening = new RegExp(`^\\d{2}\\/\\d{2}\\/\\d{4}\\s+SALDO\\s+INICIAL\\s+SALDO\\s+INICIAL\\s+(${MONEY})$`, "i").exec(line)
        if (opening?.[1]) {
          flush()
          openingBalance = money(parseMoney(opening[1]))
          continue
        }

        const closing = new RegExp(`SALDO\\s+TOTAL\\s+ATUAL\\s+SALDO\\s+TOTAL\\s+ATUAL\\s+(${MONEY})\\s+[CD]`, "i").exec(line)
        if (closing?.[1]) {
          flush()
          closingBalance = money(parseMoney(closing[1]))
          continue
        }

        if (/^SALDO\s+DO\s+DIA\b/i.test(line) || isIgnoredLine(line)) {
          flush()
          continue
        }

        const dated = /^(\d{2}\/\d{2}\/\d{4})\s+/.exec(line)
        if (dated?.[1]) {
          flush()
          const amounts = line.match(new RegExp(MONEY, "g")) ?? []
          if (amounts.length < 2) {
            addIssue(issues, { severity: "ERROR", code: "STATEMENT_ROW_INCOMPLETE", message: "Linha do extrato BMP sem valor e saldo completos." })
            continue
          }

          const firstAmountIndex = line.indexOf(amounts[0]!)
          const rawDescription = line.slice(dated[0].length, firstAmountIndex).trim()
          const description = dedupeRepeatedTokens(rawDescription)
          const direction = directionOf(description)
          if (!direction) {
            addIssue(issues, { severity: "ERROR", code: "TRANSACTION_DIRECTION_UNKNOWN", message: "O histórico do extrato BMP não permite determinar crédito ou débito com segurança." })
            continue
          }

          const absoluteAmount = parseMoney(amounts[0]!).abs()
          draft = {
            postingDate: dated[1],
            description: [description],
            amount: money(direction === "DEBIT" ? absoluteAmount.negated() : absoluteAmount),
            direction,
            runningBalance: money(parseMoney(amounts.at(-1)!)),
            page,
          }
          continue
        }

        if (draft && isDescriptionContinuation(line)) draft.description.push(line)
      }
      flush()
    }

    validateRunningBalances(openingBalance, closingBalance, transactions, issues)

    return {
      sourceId: source.sourceId,
      format: "PDF",
      institutionCode: BANK_CODE,
      documentType: "CURRENT_ACCOUNT",
      layoutFamily: "BMP_CC_EXTRATO",
      adapterId: "BMP_CC_EXTRATO",
      adapterVersion: "1",
      identity: {
        bankCode: BANK_CODE,
        bankName: "BMP",
        ...(identityMatch?.[1] ? { agency: { raw: identityMatch[1], normalized: identityMatch[1] } } : {}),
        ...(identityMatch?.[2] ? { account: { raw: identityMatch[2], normalized: identityMatch[2].replace(/\D/g, "") } } : {}),
      },
      ...(periodMatch?.[1] && periodMatch[2] ? { period: { start: parseDate(periodMatch[1]), end: parseDate(periodMatch[2]) } } : {}),
      transactions,
      ...(openingBalance ? { openingBalance } : {}),
      ...(closingBalance ? { closingBalance } : {}),
      issues,
    }
  },

  validate(document): StatementSourceValidation {
    const issues = [...document.issues]
    if (!document.identity.agency || !document.identity.account) addIssue(issues, { severity: "ERROR", code: "BANK_IDENTITY_MISSING", message: "Agência ou conta BMP não detectada." })
    if (!document.period) addIssue(issues, { severity: "ERROR", code: "STATEMENT_PERIOD_MISSING", message: "Período do extrato BMP não detectado." })
    if (!document.openingBalance) addIssue(issues, { severity: "ERROR", code: "OPENING_BALANCE_MISSING", message: "Saldo inicial do extrato BMP não detectado." })
    if (!document.closingBalance) addIssue(issues, { severity: "ERROR", code: "CLOSING_BALANCE_MISSING", message: "Saldo final do extrato BMP não detectado." })
    if (!document.transactions.length) addIssue(issues, { severity: "ERROR", code: "STATEMENT_MOVEMENTS_NOT_EXTRACTED", message: "Nenhum movimento BMP foi extraído." })
    return { accepted: issues.every((issue) => issue.severity !== "ERROR"), issues }
  },
}

function validateRunningBalances(
  openingBalance: string | undefined,
  closingBalance: string | undefined,
  transactions: readonly CanonicalBankTransaction[],
  issues: ImportIssue[],
): void {
  if (!openingBalance || !closingBalance || !transactions.length) return
  let expected = parseMoney(openingBalance)
  let failed = false
  for (const transaction of transactions) {
    expected = expected.plus(parseMoney(transaction.amount))
    if (!transaction.runningBalance || !expected.eq(parseMoney(transaction.runningBalance))) failed = true
  }
  if (!expected.eq(parseMoney(closingBalance))) failed = true
  if (failed) addIssue(issues, { severity: "ERROR", code: "BALANCE_INTEGRITY_FAILED", message: "Os saldos acumulados do extrato BMP não fecham com os movimentos." })
}

function directionOf(description: string): "DEBIT" | "CREDIT" | undefined {
  if (/^RECEBIMENTO\b/i.test(description)) return "CREDIT"
  if (/^(?:ENVIO\s+PIX|CUSTO\s+ENVIO\s+PIX)\b/i.test(description)) return "DEBIT"
  return undefined
}

function dedupeRepeatedTokens(value: string): string {
  const tokens = value.trim().split(/\s+/)
  if (tokens.length % 2 !== 0) return value.trim()
  const middle = tokens.length / 2
  const left = tokens.slice(0, middle)
  const right = tokens.slice(middle)
  return left.every((token, index) => token.toUpperCase() === right[index]?.toUpperCase()) ? left.join(" ") : value.trim()
}

function isIgnoredLine(line: string): boolean {
  return /^(?:DATA\s+DATA|TOTAIS\s+NO\s+PERIODO|SALDO\s+(?:BLOQUEADO|DISPONIVEL)|DATA\s+DA\s+EMISSAO)\b/i.test(line)
}

function isDescriptionContinuation(line: string): boolean {
  return Boolean(line)
    && !/^\d{2}\/\d{2}\/\d{4}\b/.test(line)
    && !/^(?:CPF\/CNPJ|PERIODO|EXTRATO|DATA\s+DATA|TOTAIS\s+NO\s+PERIODO|SALDO)\b/i.test(line)
}

function addIssue(issues: ImportIssue[], issue: ImportIssue): void {
  if (!issues.some((current) => current.code === issue.code)) issues.push(issue)
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
