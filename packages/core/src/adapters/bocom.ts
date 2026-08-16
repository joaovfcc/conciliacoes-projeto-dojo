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

const BANK_CODE = "107"
const BANK_NAME = "BOCOM BBM"
const MONEY_TOKEN = "(?:R\\$\\s*)?-?\\s*(?:\\d{1,3}(?:\\.\\d{3})*|\\d+),\\d{2}"

type BalanceControl = "OPENING" | "DAILY_CLOSING" | "FINAL_CLOSING"

export const bocomAnalyticCurrentAccountAdapter: StatementSourceAdapter<"PDF"> = {
  adapterId: "BOCOM_CC_ANALITICO",
  adapterVersion: "1",
  format: "PDF",
  institutionCode: BANK_CODE,
  documentType: "CURRENT_ACCOUNT",
  layoutFamily: "BOCOM_CC_ANALITICO",

  detect(source): StatementSourceDetection {
    const upper = normalizeAscii(joinPages(source)).toUpperCase()
    const signatures = [
      /BANCO\s+BOCOM\s+BBM/,
      /EXTRATO\s+DE\s+CONTA\s*-?\s*ANALITICO/,
      /RAZAO\s+SOCIAL\s+BANCO\s*\|?\s*AGENCIA\s*\|?\s*C\/C/,
    ]
    const matches = signatures.filter((signature) => signature.test(upper))
    const matched = matches.length === signatures.length
    return {
      matched,
      score: matched ? 100 : matches.length * 20,
      evidenceCodes: matches.map((_, index) => `SIGNATURE:BOCOM_ANALITICO_${index + 1}`),
    }
  },

  parse(source): CanonicalStatementDocument {
    const normalizedText = normalizeAscii(joinPages(source))
    const identityMatch = /\b107\s+(\d+)\s+([\d.-]+)\s*$/im.exec(normalizedText)
    const periodMatch = /EXTRATO\s+DO\s+DIA\s+(\d{2}\/\d{2}\/\d{4})\s+AO\s+DIA\s+(\d{2}\/\d{2}\/\d{4})/i.exec(normalizedText)
    const transactions: CanonicalBankTransaction[] = []
    const issues: ImportIssue[] = []
    let openingBalance: string | undefined
    let closingBalance: string | undefined
    let calculatedBalance: ReturnType<typeof parseMoney> | undefined
    let pendingControl: BalanceControl | undefined
    let currentDate: string | undefined
    let currentPage: ExtractedPdfPage | undefined
    let pendingDescription: string[] = []
    let dateGroupCount = 0
    let dailyClosingCount = 0

    const incompletePendingDescription = (): void => {
      if (!pendingDescription.length) return
      addIssue(issues, {
        severity: "ERROR",
        code: "STATEMENT_ROW_INCOMPLETE",
        message: "Uma descrição do extrato Bocom BBM ficou sem valor associado.",
      })
      pendingDescription = []
    }

    const applyBalanceControl = (control: BalanceControl, rawAmount: string): void => {
      const balance = money(parseMoney(rawAmount))
      if (control === "OPENING") {
        openingBalance = balance
        calculatedBalance = parseMoney(balance)
      } else if (control === "DAILY_CLOSING") {
        dailyClosingCount += 1
        if (!calculatedBalance || !calculatedBalance.eq(parseMoney(balance))) addBalanceIssue(issues)
        currentDate = undefined
        currentPage = undefined
      } else {
        closingBalance = balance
        if (!calculatedBalance || !calculatedBalance.eq(parseMoney(balance))) addBalanceIssue(issues)
      }
      pendingControl = undefined
    }

    for (const page of source.pages ?? []) {
      for (const rawLine of splitLines(page.text)) {
        const line = normalizeAscii(rawLine)
        const upper = line.toUpperCase()
        const amountMatch = lastMoneyMatch(line)

        if (/^SALDO\s+ANTERIOR\b/.test(upper)) {
          incompletePendingDescription()
          pendingControl = "OPENING"
          if (amountMatch) applyBalanceControl("OPENING", amountMatch.value)
          continue
        }
        if (/^SALDO\s+FINAL\s+TOTAL\b/.test(upper)) {
          incompletePendingDescription()
          pendingControl = "DAILY_CLOSING"
          if (amountMatch) applyBalanceControl("DAILY_CLOSING", amountMatch.value)
          continue
        }
        if (/^SALDO\s+FINAL\b/.test(upper)) {
          incompletePendingDescription()
          pendingControl = "FINAL_CLOSING"
          if (amountMatch) applyBalanceControl("FINAL_CLOSING", amountMatch.value)
          continue
        }

        if (pendingControl && amountMatch) {
          applyBalanceControl(pendingControl, amountMatch.value)
          continue
        }

        const dateMatch = /^(\d{2}\/\d{2}\/\d{4})$/.exec(line)
        if (dateMatch?.[1]) {
          incompletePendingDescription()
          if (currentDate) addMissingDailyBalanceIssue(issues)
          currentDate = dateMatch[1]
          currentPage = page
          dateGroupCount += 1
          continue
        }

        if (isIgnoredLine(upper) || !currentDate) continue

        if (!amountMatch) {
          pendingDescription.push(line)
          continue
        }

        const inlineDescription = line.slice(0, amountMatch.index).trim()
        const description = [...pendingDescription, ...(inlineDescription ? [inlineDescription] : [])]
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
        pendingDescription = []
        if (!description) {
          addIssue(issues, {
            severity: "ERROR",
            code: "STATEMENT_ROW_INCOMPLETE",
            message: "Um valor do extrato Bocom BBM ficou sem descrição associada.",
          })
          continue
        }

        const amount = parseMoney(amountMatch.value)
        if (amount.isZero()) {
          addIssue(issues, {
            severity: "ERROR",
            code: "TRANSACTION_ZERO_AMOUNT",
            message: "Um lançamento de valor zero foi rejeitado no extrato Bocom BBM.",
          })
          continue
        }
        calculatedBalance = calculatedBalance?.plus(amount)
        transactions.push({
          transactionId: `tx-${transactions.length + 1}`,
          postingDate: parseDate(currentDate),
          amount: money(amount),
          direction: amount.isNegative() ? "DEBIT" : "CREDIT",
          description,
          ...(calculatedBalance ? { runningBalance: money(calculatedBalance) } : {}),
          provenance: createSourceProvenance({
            sourceId: source.sourceId,
            format: "PDF",
            adapterId: "BOCOM_CC_ANALITICO",
            adapterVersion: "1",
            rawHash: source.sha256,
            extractionMethod: currentPage?.method ?? page.method,
            page: currentPage?.page ?? page.page,
          }),
        })
      }
    }

    incompletePendingDescription()
    if (currentDate || dateGroupCount !== dailyClosingCount) addMissingDailyBalanceIssue(issues)
    if (openingBalance && closingBalance && calculatedBalance && !calculatedBalance.eq(parseMoney(closingBalance))) {
      addBalanceIssue(issues)
    }

    return {
      sourceId: source.sourceId,
      format: "PDF",
      institutionCode: BANK_CODE,
      documentType: "CURRENT_ACCOUNT",
      layoutFamily: "BOCOM_CC_ANALITICO",
      adapterId: "BOCOM_CC_ANALITICO",
      adapterVersion: "1",
      identity: bocomIdentity(identityMatch?.[1], identityMatch?.[2]),
      ...(periodMatch?.[1] && periodMatch[2]
        ? { period: { start: parseDate(periodMatch[1]), end: parseDate(periodMatch[2]) } }
        : {}),
      transactions,
      ...(openingBalance ? { openingBalance } : {}),
      ...(closingBalance ? { closingBalance } : {}),
      issues,
    }
  },

  validate(document): StatementSourceValidation {
    const issues = [...document.issues]
    validateCommonFields(document, issues)
    if (!document.openingBalance) addIssue(issues, { severity: "ERROR", code: "OPENING_BALANCE_MISSING", message: "Saldo anterior do extrato Bocom BBM não detectado." })
    if (!document.transactions.length) addIssue(issues, { severity: "ERROR", code: "STATEMENT_MOVEMENTS_NOT_EXTRACTED", message: "Nenhum movimento foi extraído do extrato analítico Bocom BBM." })
    return validationResult(issues)
  },
}

export const bocomEmptyCurrentAccountAdapter: StatementSourceAdapter<"PDF"> = {
  adapterId: "BOCOM_CC_EMPTY",
  adapterVersion: "1",
  format: "PDF",
  institutionCode: BANK_CODE,
  documentType: "CURRENT_ACCOUNT",
  layoutFamily: "BOCOM_CC_EMPTY",

  detect(source): StatementSourceDetection {
    const upper = normalizeAscii(joinPages(source)).toUpperCase()
    const signatures = [
      /(?:BANCO\s+BOCOM\s+BBM|\bBBM\b)/,
      /CONTA\s+CORRENTE/,
      /CONTA\s*:\s*107\s+\d+\s+[\d-]+/,
      /SEM\s+TRANSACOES/,
    ]
    const matches = signatures.filter((signature) => signature.test(upper))
    const matched = matches.length === signatures.length
    return {
      matched,
      score: matched ? 100 : matches.length * 15,
      evidenceCodes: matches.map((_, index) => `SIGNATURE:BOCOM_EMPTY_${index + 1}`),
    }
  },

  parse(source): CanonicalStatementDocument {
    const normalizedText = normalizeAscii(joinPages(source))
    const identityMatch = /CONTA\s*:\s*107\s+(\d+)\s+([\d-]+)/i.exec(normalizedText)
    const balanceMatch = new RegExp(`(${MONEY_TOKEN})`).exec(normalizedText)
    const declaresNoMovements = /SEM\s+TRANSACOES/i.test(normalizedText)

    return {
      sourceId: source.sourceId,
      format: "PDF",
      institutionCode: BANK_CODE,
      documentType: "CURRENT_ACCOUNT",
      layoutFamily: "BOCOM_CC_EMPTY",
      adapterId: "BOCOM_CC_EMPTY",
      adapterVersion: "1",
      identity: bocomIdentity(identityMatch?.[1], identityMatch?.[2]),
      transactions: [],
      ...(declaresNoMovements ? { declaresNoMovements: true } : {}),
      ...(balanceMatch?.[1] ? { closingBalance: money(parseMoney(balanceMatch[1])) } : {}),
      issues: [],
    }
  },

  validate(document): StatementSourceValidation {
    const issues = [...document.issues]
    validateCommonFields(document, issues)
    if (!document.declaresNoMovements) addIssue(issues, { severity: "ERROR", code: "STATEMENT_MOVEMENTS_NOT_EXTRACTED", message: "O extrato Bocom BBM não declara ausência de transações." })
    return validationResult(issues)
  },
}

function bocomIdentity(agency: string | undefined, account: string | undefined): CanonicalStatementDocument["identity"] {
  return {
    bankCode: BANK_CODE,
    bankName: BANK_NAME,
    ...(agency ? { agency: { raw: agency, normalized: agency.replace(/\D/g, "") } } : {}),
    ...(account ? { account: { raw: account, normalized: account.replace(/\D/g, "") } } : {}),
  }
}

function validateCommonFields(document: CanonicalStatementDocument, issues: ImportIssue[]): void {
  if (!document.identity.agency || !document.identity.account) addIssue(issues, { severity: "ERROR", code: "BANK_IDENTITY_MISSING", message: "Agência ou conta Bocom BBM não detectada." })
  if (!document.period) addIssue(issues, { severity: "ERROR", code: "STATEMENT_PERIOD_MISSING", message: "Período do extrato Bocom BBM não detectado." })
  if (!document.closingBalance) addIssue(issues, { severity: "ERROR", code: "CLOSING_BALANCE_MISSING", message: "Saldo final do extrato Bocom BBM não detectado." })
}

function addBalanceIssue(issues: ImportIssue[]): void {
  addIssue(issues, {
    severity: "ERROR",
    code: "BALANCE_INTEGRITY_FAILED",
    message: "Os saldos anterior, diário e final do extrato Bocom BBM não fecham com os movimentos.",
  })
}

function addMissingDailyBalanceIssue(issues: ImportIssue[]): void {
  addIssue(issues, {
    severity: "ERROR",
    code: "DAILY_BALANCE_CONTROL_MISSING",
    message: "Um grupo diário do extrato Bocom BBM não possui saldo final total.",
  })
}

function validationResult(issues: ImportIssue[]): StatementSourceValidation {
  return { accepted: issues.every((issue) => issue.severity !== "ERROR"), issues }
}

function addIssue(issues: ImportIssue[], issue: ImportIssue): void {
  if (!issues.some((current) => current.code === issue.code)) issues.push(issue)
}

function isIgnoredLine(upper: string): boolean {
  return /^(?:DESCRICAO\s+CONTRAPARTE\s+VALOR|CONTA\s+CORRENTE|RAZAO\s+SOCIAL|EXTRATO\b|AS\s+INFORMACOES|FALE\s+COM\s+A\s+OUVIDORIA|BANCO\s+BOCOM)\b/.test(upper)
}

function lastMoneyMatch(line: string): { value: string; index: number } | undefined {
  const match = new RegExp(`(${MONEY_TOKEN})\\s*$`, "i").exec(line)
  return match?.[1] && match.index !== undefined ? { value: match[1], index: match.index } : undefined
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
