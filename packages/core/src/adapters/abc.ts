import { money, parseDate, parseMoney } from "../normalization.js"
import {
  createSourceProvenance,
  type CanonicalBankTransaction,
  type CanonicalStatementDocument,
  type ExtractedStatementSource,
  type StatementSourceAdapter,
  type StatementSourceDetection,
  type StatementSourceValidation,
} from "../statement-sources.js"
import type { ImportIssue } from "../types.js"

const BANK_CODE = "246"
const BANK_SIGNATURE = "BANCO ABC BRASIL"
const CURRENT_LAYOUT_SIGNATURE = "EXTRATO DETALHADO DE MOVIMENTACAO"
const LINKED_LAYOUT_SIGNATURE = "EXTRATO DETALHADO DA CONTA VINCULADA"
const MONEY_TOKEN = "-?(?:\\d{1,3}(?:\\.\\d{3})*|\\d+),\\d{2}"

export const abcCurrentAccountAdapter: StatementSourceAdapter<"PDF"> = {
  adapterId: "ABC_CC_EXTRATO_DETALHADO",
  adapterVersion: "1",
  format: "PDF",
  institutionCode: BANK_CODE,
  documentType: "CURRENT_ACCOUNT",
  layoutFamily: "ABC_CC_EXTRATO_DETALHADO",

  detect(source): StatementSourceDetection {
    return detectLayout(source, CURRENT_LAYOUT_SIGNATURE)
  },

  parse(source): CanonicalStatementDocument {
    const normalizedText = normalizeAscii(joinPages(source))
    const identity = currentIdentity(normalizedText)
    const period = extractPeriod(normalizedText)
    const closingMatch = new RegExp(`SALDO\\s+DA\\s+CONTA\\s+CORRENTE\\s+(-?\\s*R\\$\\s*${MONEY_TOKEN.replace(/^-\?/, "")})`, "i").exec(normalizedText)
    const closingBalance = closingMatch?.[1] ? money(parseMoney(closingMatch[1])) : undefined
    const transactions: CanonicalBankTransaction[] = []
    const issues: ImportIssue[] = []
    let openingBalance: string | undefined

    const movementPattern = new RegExp(
      `^(\\d{2}\\/\\d{2}\\/\\d{4})\\s+(\\S+)\\s+(.+?)\\s+(CREDITO|DEBITO)\\s+\\([+-]\\)\\s+(${MONEY_TOKEN})\\s+(${MONEY_TOKEN}|-)$`,
      "i",
    )

    for (const page of source.pages ?? []) {
      for (const rawLine of splitLines(page.text)) {
        const line = normalizeAscii(rawLine)
        if (/SALDO\s+ANTERIOR/i.test(line)) {
          const balance = new RegExp(`(${MONEY_TOKEN})\\s*$`).exec(line)?.[1]
          if (balance) openingBalance = money(parseMoney(balance))
          continue
        }

        const movement = movementPattern.exec(line)
        if (!movement?.[1] || !movement[2] || !movement[3] || !movement[4] || !movement[5] || !movement[6]) continue

        const amount = parseMoney(movement[5])
        const direction = movement[4].toUpperCase() === "DEBITO" ? "DEBIT" : "CREDIT"
        if ((direction === "DEBIT" && !amount.isNegative()) || (direction === "CREDIT" && amount.isNegative())) {
          addIssue(issues, {
            severity: "ERROR",
            code: "TRANSACTION_SIGN_CONFLICT",
            message: "O sinal do valor diverge da operação informada no extrato ABC Brasil.",
          })
        }

        transactions.push({
          transactionId: `tx-${transactions.length + 1}`,
          postingDate: parseDate(movement[1]),
          amount: money(amount),
          direction,
          description: movement[3].trim().replace(/\s+/g, " "),
          ...(movement[2] !== "-" ? { documentNumber: movement[2] } : {}),
          ...(movement[6] !== "-" ? { runningBalance: money(parseMoney(movement[6])) } : {}),
          provenance: createSourceProvenance({
            sourceId: source.sourceId,
            format: "PDF",
            adapterId: "ABC_CC_EXTRATO_DETALHADO",
            adapterVersion: "1",
            rawHash: source.sha256,
            extractionMethod: page.method,
            page: page.page,
          }),
        })
      }
    }

    validateClosingControls(openingBalance, closingBalance, transactions, issues)

    return {
      sourceId: source.sourceId,
      format: "PDF",
      institutionCode: BANK_CODE,
      documentType: "CURRENT_ACCOUNT",
      layoutFamily: "ABC_CC_EXTRATO_DETALHADO",
      adapterId: "ABC_CC_EXTRATO_DETALHADO",
      adapterVersion: "1",
      identity: bankIdentity(identity),
      ...(period ? { period } : {}),
      transactions,
      ...(openingBalance ? { openingBalance } : {}),
      ...(closingBalance ? { closingBalance } : {}),
      issues,
    }
  },

  validate(document): StatementSourceValidation {
    const issues = [...document.issues]
    validateRequiredFields(document, issues)
    if (!document.openingBalance) addIssue(issues, { severity: "ERROR", code: "OPENING_BALANCE_MISSING", message: "Saldo anterior do extrato ABC Brasil não detectado." })
    if (!document.transactions.length) addIssue(issues, { severity: "ERROR", code: "STATEMENT_MOVEMENTS_NOT_EXTRACTED", message: "Nenhum movimento foi extraído do extrato ABC Brasil." })
    return validationResult(issues)
  },
}

export const abcLinkedAccountAdapter: StatementSourceAdapter<"PDF"> = {
  adapterId: "ABC_CONTA_VINCULADA",
  adapterVersion: "1",
  format: "PDF",
  institutionCode: BANK_CODE,
  documentType: "CURRENT_ACCOUNT",
  layoutFamily: "ABC_CONTA_VINCULADA",

  detect(source): StatementSourceDetection {
    return detectLayout(source, LINKED_LAYOUT_SIGNATURE)
  },

  parse(source): CanonicalStatementDocument {
    const normalizedText = normalizeAscii(joinPages(source))
    const identityMatch = /AGENCIA\s*:\s*([\d-]+)\s+CONTA\s*:\s*([\d-]+)/i.exec(normalizedText)
    const period = extractPeriod(normalizedText)
    const closingMatch = new RegExp(`SALDO\\s+DA\\s+CONTA\\s+VINCULADA\\s+(${MONEY_TOKEN})`, "i").exec(normalizedText)
    const declaresNoMovements = /NAO\s+EXISTEM\s+LANCAMENTOS\s+PARA\s+O\s+PERIODO\s+SELECIONADO/i.test(normalizedText)

    return {
      sourceId: source.sourceId,
      format: "PDF",
      institutionCode: BANK_CODE,
      documentType: "CURRENT_ACCOUNT",
      layoutFamily: "ABC_CONTA_VINCULADA",
      adapterId: "ABC_CONTA_VINCULADA",
      adapterVersion: "1",
      identity: bankIdentity(identityMatch?.[1] && identityMatch[2]
        ? { agency: identityMatch[1], account: identityMatch[2] }
        : undefined),
      ...(period ? { period } : {}),
      transactions: [],
      ...(declaresNoMovements ? { declaresNoMovements: true } : {}),
      ...(closingMatch?.[1] ? { closingBalance: money(parseMoney(closingMatch[1])) } : {}),
      issues: [],
    }
  },

  validate(document): StatementSourceValidation {
    const issues = [...document.issues]
    validateRequiredFields(document, issues)
    if (!document.declaresNoMovements) addIssue(issues, { severity: "ERROR", code: "STATEMENT_MOVEMENTS_NOT_EXTRACTED", message: "A conta vinculada não declarou ausência de lançamentos." })
    return validationResult(issues)
  },
}

function detectLayout(source: ExtractedStatementSource, layoutSignature: string): StatementSourceDetection {
  const upper = normalizeAscii(joinPages(source)).toUpperCase()
  const bankMatched = upper.includes(BANK_SIGNATURE)
  const layoutMatched = upper.includes(layoutSignature)
  const matched = bankMatched && layoutMatched
  return {
    matched,
    score: matched ? 100 : (bankMatched ? 20 : 0) + (layoutMatched ? 20 : 0),
    evidenceCodes: [
      ...(bankMatched ? [`SIGNATURE:${BANK_SIGNATURE}`] : []),
      ...(layoutMatched ? [`SIGNATURE:${layoutSignature}`] : []),
    ],
  }
}

function currentIdentity(text: string): { agency: string; account: string } | undefined {
  const match = /BANCO\s+ABC\s+BRASIL\s+([\d-]+)\s+([\d-]+)/i.exec(text)
  return match?.[1] && match[2] ? { agency: match[1], account: match[2] } : undefined
}

function bankIdentity(identity: { agency: string; account: string } | undefined): CanonicalStatementDocument["identity"] {
  return {
    bankCode: BANK_CODE,
    bankName: "ABC BRASIL",
    ...(identity ? {
      agency: { raw: identity.agency, normalized: identity.agency.replace(/\D/g, "") },
      account: { raw: identity.account, normalized: identity.account.replace(/\D/g, "") },
    } : {}),
  }
}

function extractPeriod(text: string): { start: string; end: string } | undefined {
  const match = /\bDE\s+(\d{2}\/\d{2}\/\d{4})\s+A\s+(\d{2}\/\d{2}\/\d{4})\b/i.exec(text)
  return match?.[1] && match[2] ? { start: parseDate(match[1]), end: parseDate(match[2]) } : undefined
}

function validateClosingControls(
  openingBalance: string | undefined,
  closingBalance: string | undefined,
  transactions: readonly CanonicalBankTransaction[],
  issues: ImportIssue[],
): void {
  if (!openingBalance || !closingBalance || !transactions.length) return
  const expectedClosing = transactions.reduce(
    (balance, transaction) => balance.plus(parseMoney(transaction.amount)),
    parseMoney(openingBalance),
  )
  let lastRunningBalance: string | undefined
  for (let index = transactions.length - 1; index >= 0; index -= 1) {
    if (transactions[index]?.runningBalance !== undefined) {
      lastRunningBalance = transactions[index]?.runningBalance
      break
    }
  }
  if (!expectedClosing.eq(parseMoney(closingBalance))
    || (lastRunningBalance !== undefined && !parseMoney(lastRunningBalance).eq(parseMoney(closingBalance)))) {
    addIssue(issues, {
      severity: "ERROR",
      code: "BALANCE_INTEGRITY_FAILED",
      message: "Os saldos inicial, final e os movimentos do extrato ABC Brasil não fecham.",
    })
  }
}

function validateRequiredFields(document: CanonicalStatementDocument, issues: ImportIssue[]): void {
  if (!document.identity.agency || !document.identity.account) addIssue(issues, { severity: "ERROR", code: "BANK_IDENTITY_MISSING", message: "Agência ou conta ABC Brasil não detectada." })
  if (!document.period) addIssue(issues, { severity: "ERROR", code: "STATEMENT_PERIOD_MISSING", message: "Período do extrato ABC Brasil não detectado." })
  if (!document.closingBalance) addIssue(issues, { severity: "ERROR", code: "CLOSING_BALANCE_MISSING", message: "Saldo final do extrato ABC Brasil não detectado." })
}

function validationResult(issues: ImportIssue[]): StatementSourceValidation {
  return { accepted: issues.every((issue) => issue.severity !== "ERROR"), issues }
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
