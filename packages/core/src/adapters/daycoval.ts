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

const BANK_CODE = "707"
const MONEY_TOKEN = "(?:\\d{1,3}(?:\\.\\d{3})*|\\d+),\\d{2}"
const CURRENCY_TOKEN = `-?\\s*R\\$\\s*-?\\s*${MONEY_TOKEN}`

type RawTransaction = {
  postingDate: string
  description: string[]
  amount: string
  page: ExtractedPdfPage
  sourceOrder: number
  dailyGroupId?: number
}

type DailyGroup = { id: number; control?: string; transactionOrders: number[] }

export const daycovalCurrentAccountAdapter: StatementSourceAdapter<"PDF"> = {
  adapterId: "DAYCOVAL_CC_EXTRATO_DETALHADO",
  adapterVersion: "1",
  format: "PDF",
  institutionCode: BANK_CODE,
  documentType: "CURRENT_ACCOUNT",
  layoutFamily: "DAYCOVAL_CC_EXTRATO_DETALHADO",

  detect(source): StatementSourceDetection {
    const upper = normalizeAscii(joinPages(source)).toUpperCase()
    const signatures = ["BANCO DAYCOVAL", "EXTRATO DETALHADO", "CONTA CORRENTE", "DAYCONNECT@DAYCOVAL"]
    const matches = signatures.filter((signature) => upper.includes(signature))
    const matched = matches.length === signatures.length
    return {
      matched,
      score: matched ? 100 : matches.length * 20,
      evidenceCodes: matches.map((signature) => `SIGNATURE:${signature}`),
    }
  },

  parse(source): CanonicalStatementDocument {
    const normalizedText = normalizeAscii(joinPages(source))
    const identityAndPeriod = extractIdentityAndPeriod(normalizedText)
    const rawTransactions: RawTransaction[] = []
    const dailyGroups: DailyGroup[] = []
    const openingControls: string[] = []
    const issues: ImportIssue[] = []
    let closingBalance: string | undefined
    let pendingOpening = false
    let currentDailyGroup: DailyGroup | undefined
    let lastTransaction: RawTransaction | undefined
    let sourceOrder = 0

    for (const page of source.pages ?? []) {
      for (const rawLine of splitLines(page.text)) {
        const line = normalizeAscii(rawLine)
        const upper = line.toUpperCase()
        const currency = lastCurrencyMatch(line)

        if (/^SALDO\s+ANTERIOR\b/i.test(line)) {
          lastTransaction = undefined
          pendingOpening = !currency
          if (currency) openingControls.push(currencyAmount(currency.value))
          continue
        }
        if (pendingOpening && currency && currency.index === 0) {
          openingControls.push(currencyAmount(currency.value))
          pendingOpening = false
          continue
        }
        if (/^SALDO\s+ATUAL\b/i.test(line)) {
          lastTransaction = undefined
          if (currency) closingBalance = currencyAmount(currency.value)
          continue
        }

        const heading = /\b\d{2}\s+DE\s+[A-Z]+\b/i.test(line)
        if (heading) {
          currentDailyGroup = {
            id: dailyGroups.length + 1,
            ...(currency && /SALDO\s*:/i.test(line) ? { control: currencyAmount(currency.value) } : {}),
            transactionOrders: [],
          }
          dailyGroups.push(currentDailyGroup)
          lastTransaction = undefined
          continue
        }
        if (currentDailyGroup && /\bSALDO\s*:/i.test(line) && currency) {
          currentDailyGroup.control = currencyAmount(currency.value)
          lastTransaction = undefined
          continue
        }

        const movement = new RegExp(`^(\\d{2})\/(\\d{2})\\s+(.+?)\\s+(${CURRENCY_TOKEN})\\s*$`, "i").exec(line)
        if (movement?.[1] && movement[2] && movement[3] && movement[4] && identityAndPeriod?.period) {
          const postingDate = dateWithinPeriod(movement[1], movement[2], identityAndPeriod.period)
          if (!postingDate) {
            addIssue(issues, { severity: "ERROR", code: "TRANSACTION_DATE_OUTSIDE_PERIOD", message: "Uma data Daycoval está fora do período do extrato." })
            continue
          }
          sourceOrder += 1
          lastTransaction = {
            postingDate,
            description: [movement[3].trim()],
            amount: currencyAmount(movement[4]),
            page,
            sourceOrder,
            ...(currentDailyGroup ? { dailyGroupId: currentDailyGroup.id } : {}),
          }
          rawTransactions.push(lastTransaction)
          currentDailyGroup?.transactionOrders.push(sourceOrder)
          continue
        }

        if (lastTransaction && isDescriptionContinuation(upper)) lastTransaction.description.push(line)
      }
    }

    const openingBalance = openingControls[0]
    if (openingControls.some((control) => control !== openingBalance)) addBalanceIssue(issues)
    const ordered = [...rawTransactions].sort((left, right) => left.postingDate.localeCompare(right.postingDate)
      || right.sourceOrder - left.sourceOrder)
    validateDailyAndFinalBalances(openingBalance, closingBalance, ordered, dailyGroups, issues)

    const transactions: CanonicalBankTransaction[] = ordered.map((transaction, index) => {
      const amount = parseMoney(transaction.amount)
      return {
        transactionId: `tx-${index + 1}`,
        postingDate: transaction.postingDate,
        amount: transaction.amount,
        direction: amount.isNegative() ? "DEBIT" : "CREDIT",
        description: transaction.description.join(" ").replace(/\s+/g, " ").trim(),
        provenance: createSourceProvenance({
          sourceId: source.sourceId,
          format: "PDF",
          adapterId: "DAYCOVAL_CC_EXTRATO_DETALHADO",
          adapterVersion: "1",
          rawHash: source.sha256,
          extractionMethod: transaction.page.method,
          page: transaction.page.page,
        }),
      }
    })
    const completeGeneratedDocument = /IMPRESSAO\s+REALIZADA\s+EM/i.test(normalizedText)
      && /CENTRAL\s+DE\s+ATENDIMENTO\s+DAYCONNECT/i.test(normalizedText)
    const declaresNoMovements = transactions.length === 0
      && Boolean(openingBalance && closingBalance && parseMoney(openingBalance).eq(parseMoney(closingBalance)) && completeGeneratedDocument)

    return {
      sourceId: source.sourceId,
      format: "PDF",
      institutionCode: BANK_CODE,
      documentType: "CURRENT_ACCOUNT",
      layoutFamily: "DAYCOVAL_CC_EXTRATO_DETALHADO",
      adapterId: "DAYCOVAL_CC_EXTRATO_DETALHADO",
      adapterVersion: "1",
      identity: daycovalIdentity(identityAndPeriod?.agency, identityAndPeriod?.account),
      ...(identityAndPeriod?.period ? { period: identityAndPeriod.period } : {}),
      transactions,
      ...(declaresNoMovements ? { declaresNoMovements: true } : {}),
      ...(openingBalance ? { openingBalance } : {}),
      ...(closingBalance ? { closingBalance } : {}),
      issues,
    }
  },

  validate(document): StatementSourceValidation {
    const issues = [...document.issues]
    if (!document.identity.agency || !document.identity.account) addIssue(issues, { severity: "ERROR", code: "BANK_IDENTITY_MISSING", message: "Agência ou conta Daycoval não detectada." })
    if (!document.period) addIssue(issues, { severity: "ERROR", code: "STATEMENT_PERIOD_MISSING", message: "Período do extrato Daycoval não detectado." })
    if (!document.openingBalance) addIssue(issues, { severity: "ERROR", code: "OPENING_BALANCE_MISSING", message: "Saldo anterior Daycoval não detectado." })
    if (!document.closingBalance) addIssue(issues, { severity: "ERROR", code: "CLOSING_BALANCE_MISSING", message: "Saldo atual Daycoval não detectado." })
    if (!document.transactions.length && !document.declaresNoMovements) addIssue(issues, { severity: "ERROR", code: "STATEMENT_MOVEMENTS_NOT_EXTRACTED", message: "Nenhum movimento Daycoval foi extraído de um documento estruturalmente completo." })
    return { accepted: issues.every((issue) => issue.severity !== "ERROR"), issues }
  },
}

function validateDailyAndFinalBalances(
  openingBalance: string | undefined,
  closingBalance: string | undefined,
  transactions: readonly RawTransaction[],
  dailyGroups: readonly DailyGroup[],
  issues: ImportIssue[],
): void {
  if (!transactions.length) return
  if (!openingBalance || !closingBalance) return
  let expected = parseMoney(openingBalance)
  const groupsWithTransactions = dailyGroups
    .filter((group) => group.transactionOrders.length > 0)
    .map((group) => ({
      group,
      transactions: transactions
        .filter((transaction) => transaction.dailyGroupId === group.id)
        .sort((left, right) => left.postingDate.localeCompare(right.postingDate) || right.sourceOrder - left.sourceOrder),
    }))
    .sort((left, right) => (left.transactions[0]?.postingDate ?? "").localeCompare(right.transactions[0]?.postingDate ?? ""))

  const groupedTransactionCount = groupsWithTransactions.reduce((total, item) => total + item.transactions.length, 0)
  if (groupedTransactionCount !== transactions.length) {
    addIssue(issues, { severity: "ERROR", code: "DAILY_BALANCE_CONTROL_MISSING", message: "Um movimento Daycoval não pertence a um grupo diário com saldo." })
  }

  for (const item of groupsWithTransactions) {
    const dates = new Set(item.transactions.map((transaction) => transaction.postingDate))
    if (dates.size !== 1) {
      addIssue(issues, { severity: "ERROR", code: "DAILY_BALANCE_GROUP_AMBIGUOUS", message: "Um grupo diário Daycoval contém mais de uma data de movimento." })
    }
    for (const transaction of item.transactions) expected = expected.plus(parseMoney(transaction.amount))
    if (!item.group.control) {
      addIssue(issues, { severity: "ERROR", code: "DAILY_BALANCE_CONTROL_MISSING", message: "Um dia com movimentos Daycoval não possui saldo de fechamento." })
    } else if (!expected.eq(parseMoney(item.group.control))) {
      addBalanceIssue(issues)
    }
  }
  if (!expected.eq(parseMoney(closingBalance))) addBalanceIssue(issues)
}

function extractIdentityAndPeriod(text: string): {
  agency: string
  account: string
  period: { start: string; end: string }
} | undefined {
  const match = /(\d{2}\/\d{2}\/\d{4})\s+(?:A|ATE)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{4})\s+([\d-]+)/i.exec(text)
  return match?.[1] && match[2] && match[3] && match[4]
    ? { period: { start: parseDate(match[1]), end: parseDate(match[2]) }, agency: match[3], account: match[4] }
    : undefined
}

function dateWithinPeriod(
  day: string,
  month: string | undefined,
  period: { start: string; end: string },
): string | undefined {
  if (!month) return undefined
  const startYear = Number(period.start.slice(0, 4))
  const endYear = Number(period.end.slice(0, 4))
  for (const year of new Set([startYear, endYear])) {
    const candidate = `${year}-${month}-${day}`
    if (candidate >= period.start && candidate <= period.end) return candidate
  }
  return undefined
}

function daycovalIdentity(agency: string | undefined, account: string | undefined): CanonicalStatementDocument["identity"] {
  return {
    bankCode: BANK_CODE,
    bankName: "DAYCOVAL",
    ...(agency ? { agency: { raw: agency, normalized: agency.replace(/\D/g, "") } } : {}),
    ...(account ? { account: { raw: account, normalized: account.replace(/\D/g, "") } } : {}),
  }
}

function lastCurrencyMatch(line: string): { value: string; index: number } | undefined {
  const match = new RegExp(`(${CURRENCY_TOKEN})\\s*$`, "i").exec(line)
  return match?.[1] && match.index !== undefined ? { value: match[1], index: match.index } : undefined
}

function currencyAmount(value: string): string {
  const numeric = new RegExp(MONEY_TOKEN).exec(value)?.[0]
  if (!numeric) throw new Error("Currency amount is missing its numeric component.")
  const absolute = parseMoney(numeric).abs()
  return money(/-\s*(?:R\$)?|R\$\s*-/i.test(value) ? absolute.negated() : absolute)
}

function isDescriptionContinuation(upper: string): boolean {
  return Boolean(upper)
    && !/^(?:SALDO|TITULAR|PERIODO|AGENCIA|CONTA|LIMITE|VALOR\s+BLOQUEADO|PREVISAO|LANCAMENTOS|IMPRESSAO|CENTRAL|SAC|OUVIDORIA|HTTPS?:)/.test(upper)
    && !/\b(?:SEGUNDA|TERCA|QUARTA|QUINTA|SEXTA)-FEIRA\b/.test(upper)
}

function addBalanceIssue(issues: ImportIssue[]): void {
  addIssue(issues, { severity: "ERROR", code: "BALANCE_INTEGRITY_FAILED", message: "Os saldos anterior, diário e atual do Daycoval não fecham com os movimentos." })
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
