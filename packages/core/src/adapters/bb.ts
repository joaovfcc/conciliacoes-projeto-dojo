import { money, parseDate, parseMoney } from "../normalization.js"
import {
  createSourceProvenance,
  type CanonicalBankTransaction,
  type CanonicalInvestmentEntry,
  type CanonicalStatementDocument,
  type ExtractedPdfPage,
  type ExtractedStatementSource,
  type StatementSourceAdapter,
  type StatementSourceDetection,
  type StatementSourceValidation,
} from "../statement-sources.js"
import type { ImportIssue } from "../types.js"

const BANK_CODE = "001"
const CURRENT_SIGNATURE = "CONSULTAS - EXTRATO DE CONTA CORRENTE"
const INVESTMENT_SIGNATURE = "BB RENDE FACIL"
const MONEY = "(?:\\d{1,3}(?:\\.\\d{3})*|\\d+),\\d{2}"

type CurrentDraft = {
  postingDate: string
  documentNumber?: string
  description: string[]
  amount: string
  direction: "DEBIT" | "CREDIT"
  runningBalance?: string
  page: ExtractedPdfPage
}

export const bbCurrentAccountAdapter: StatementSourceAdapter<"PDF"> = {
  adapterId: "BB_CC_CONSULTAS",
  adapterVersion: "1",
  format: "PDF",
  institutionCode: BANK_CODE,
  documentType: "CURRENT_ACCOUNT",
  layoutFamily: "BB_CC_CONSULTAS",

  detect(source): StatementSourceDetection {
    const upper = normalizeAscii(joinPages(source)).toUpperCase()
    const bankMatched = upper.includes("BANCO DO BRASIL")
    const layoutMatched = upper.includes(CURRENT_SIGNATURE)
    return detection(bankMatched, layoutMatched, ["BANCO DO BRASIL", CURRENT_SIGNATURE])
  },

  parse(source): CanonicalStatementDocument {
    const normalizedText = normalizeAscii(joinPages(source))
    const agency = /AGENCIA\s+([\d-]+)/i.exec(normalizedText)?.[1]
    const account = /CONTA\s+CORRENTE\s+([\d-]+)/i.exec(normalizedText)?.[1]
    const transactions: CanonicalBankTransaction[] = []
    const issues: ImportIssue[] = []
    let openingBalance: string | undefined
    let closingBalance: string | undefined
    let closingDate: string | undefined
    let draft: CurrentDraft | undefined

    const flush = (): void => {
      if (!draft) return
      transactions.push({
        transactionId: `tx-${transactions.length + 1}`,
        postingDate: parseDate(draft.postingDate),
        amount: draft.amount,
        direction: draft.direction,
        description: draft.description.join(" ").replace(/\s+/g, " ").trim(),
        ...(draft.documentNumber ? { documentNumber: draft.documentNumber } : {}),
        ...(draft.runningBalance ? { runningBalance: draft.runningBalance } : {}),
        provenance: createSourceProvenance({
          sourceId: source.sourceId,
          format: "PDF",
          adapterId: "BB_CC_CONSULTAS",
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
        const dated = /^(\d{2}\/\d{2}\/\d{4})\s+/.exec(line)
        if (dated) flush()

        if (dated?.[1] && /SALDO\s+ANTERIOR/i.test(line)) {
          openingBalance = markedAmounts(line).at(-1)?.amount
          continue
        }
        if (dated?.[1] && /S\s+A\s+L\s+D\s+O/i.test(line)) {
          const control = markedAmounts(line).at(-1)
          if (control) closingBalance = control.amount
          closingDate = dated[1]
          continue
        }

        if (dated?.[1]) {
          const controls = markedAmounts(line)
          const movement = controls[0]
          if (!movement) continue
          const firstControlIndex = line.indexOf(movement.raw)
          const prefix = line.slice(0, firstControlIndex).trim()
          const prefixMatch = /^(\d{2}\/\d{2}\/\d{4})\s+\d{4}\s+\d{5}\s+(.+)$/.exec(prefix)
          if (!prefixMatch?.[1] || !prefixMatch[2]) continue

          const parts = prefixMatch[2].trim().split(/\s+/)
          const possibleDocument = parts.at(-1)
          const documentNumber = possibleDocument && /^\d[\d.]*$/.test(possibleDocument) ? parts.pop() : undefined
          draft = {
            postingDate: prefixMatch[1],
            ...(documentNumber ? { documentNumber } : {}),
            description: [parts.join(" ")],
            amount: movement.amount,
            direction: movement.direction,
            ...(controls[1] ? { runningBalance: controls[1].amount } : {}),
            page,
          }
          continue
        }

        if (draft && isCurrentDescriptionContinuation(line)) draft.description.push(line)
      }
    }
    flush()

    const referenceDate = closingDate ?? transactions.at(-1)?.postingDate
    const period = referenceDate ? monthPeriod(parseDate(referenceDate)) : undefined
    validateBalanceEquation(openingBalance, closingBalance, transactions, issues)

    return {
      sourceId: source.sourceId,
      format: "PDF",
      institutionCode: BANK_CODE,
      documentType: "CURRENT_ACCOUNT",
      layoutFamily: "BB_CC_CONSULTAS",
      adapterId: "BB_CC_CONSULTAS",
      adapterVersion: "1",
      identity: bankIdentity(agency, account),
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
    if (!document.openingBalance) addIssue(issues, { severity: "ERROR", code: "OPENING_BALANCE_MISSING", message: "Saldo anterior do Banco do Brasil não detectado." })
    if (!document.transactions.length) addIssue(issues, { severity: "ERROR", code: "STATEMENT_MOVEMENTS_NOT_EXTRACTED", message: "Nenhum movimento do Banco do Brasil foi extraído." })
    return validationResult(issues)
  },
}

export const bbRendeFacilAdapter: StatementSourceAdapter<"PDF"> = {
  adapterId: "BB_RENDE_FACIL_RESUMO",
  adapterVersion: "1",
  format: "PDF",
  institutionCode: BANK_CODE,
  documentType: "INVESTMENT_ACTIVITY",
  layoutFamily: "BB_RENDE_FACIL_RESUMO",

  detect(source): StatementSourceDetection {
    const upper = normalizeAscii(joinPages(source)).toUpperCase()
    const productMatched = upper.includes(INVESTMENT_SIGNATURE)
    const layoutMatched = upper.includes("RESUMO DO MES") || upper.includes("HISTORICO DE MOVIMENTACAO")
    return detection(productMatched, layoutMatched, [INVESTMENT_SIGNATURE, "RESUMO/HISTORICO"])
  },

  parse(source): CanonicalStatementDocument {
    const normalizedText = normalizeAscii(joinPages(source))
    const identityMatch = /AGENCIA\s+CONTA\s+([\d-]+)\s+([\d-]+)/i.exec(normalizedText)
    const closingMatches = [...normalizedText.matchAll(new RegExp(`SALDO\\s+BRUTO\\s+EM\\s+(\\d{2}\\/\\d{2}\\/\\d{4})\\s*:?\\s*R\\$\\s*(${MONEY})`, "gi"))]
    const closing = closingMatches.at(-1)
    const closingDate = closing?.[1]
    const period = closingDate ? monthPeriod(parseDate(closingDate)) : undefined
    const investments: CanonicalInvestmentEntry[] = []

    for (const page of source.pages ?? []) {
      for (const rawLine of splitLines(page.text)) {
        const line = normalizeAscii(rawLine)
        const movement = /^(\d{2}\/\d{2}\/\d{4})\s+(APLICACAO|RESGATE)\b/i.exec(line)
        if (!movement?.[1] || !movement[2]) continue
        const amounts = [...line.matchAll(new RegExp(`R\\$\\s*(${MONEY})`, "gi"))]
        const netAmount = amounts.at(-1)?.[1]
        if (!netAmount) continue
        investments.push(investmentEntry({
          source,
          page,
          postingDate: parseDate(movement[1]),
          amount: netAmount,
          kind: movement[2].toUpperCase() === "APLICACAO" ? "APPLICATION" : "REDEMPTION",
          description: movement[2].toUpperCase() === "APLICACAO" ? "BB RENDE FÁCIL - APLICAÇÃO" : "BB RENDE FÁCIL - RESGATE",
          index: investments.length + 1,
        }))
      }
    }

    const earning = new RegExp(`RENDIMENTOS\\s+NO\\s+MES\\s*:\\s*R\\$\\s*(${MONEY})`, "i").exec(normalizedText)?.[1]
    const evidencePage = source.pages?.[0]
    if (earning && evidencePage && !parseMoney(earning).isZero()) {
      investments.push(investmentEntry({
        source,
        page: evidencePage,
        ...(period ? { postingDate: period.end } : {}),
        amount: earning,
        kind: "EARNING",
        description: "BB RENDE FÁCIL - RENDIMENTOS DO MÊS",
        index: investments.length + 1,
      }))
    }

    return {
      sourceId: source.sourceId,
      format: "PDF",
      institutionCode: BANK_CODE,
      documentType: "INVESTMENT_ACTIVITY",
      layoutFamily: "BB_RENDE_FACIL_RESUMO",
      adapterId: "BB_RENDE_FACIL_RESUMO",
      adapterVersion: "1",
      identity: bankIdentity(identityMatch?.[1], identityMatch?.[2]),
      ...(period ? { period } : {}),
      transactions: [],
      investments,
      ...(closing?.[2] ? { closingBalance: money(parseMoney(closing[2])) } : {}),
      issues: [{
        severity: "WARNING",
        code: "MOVIMENTOS_INVESTIMENTO_INFORMATIVOS",
        message: "Os movimentos do BB Rende Fácil são informativos e não serão conciliados com o razão.",
      }],
    }
  },

  validate(document): StatementSourceValidation {
    const issues = [...document.issues]
    validateRequiredFields(document, issues)
    if (!document.investments?.length) addIssue(issues, { severity: "ERROR", code: "INVESTMENT_MOVEMENTS_NOT_EXTRACTED", message: "Nenhum movimento do BB Rende Fácil foi extraído." })
    return validationResult(issues)
  },
}

function markedAmounts(line: string): Array<{ raw: string; amount: string; direction: "DEBIT" | "CREDIT" }> {
  const result: Array<{ raw: string; amount: string; direction: "DEBIT" | "CREDIT" }> = []
  const pattern = new RegExp(`(${MONEY})\\s+([CD])\\b`, "gi")
  for (const match of line.matchAll(pattern)) {
    if (!match[0] || !match[1] || !match[2]) continue
    const direction = match[2].toUpperCase() === "D" ? "DEBIT" : "CREDIT"
    const absolute = parseMoney(match[1]).abs()
    result.push({ raw: match[0], amount: money(direction === "DEBIT" ? absolute.negated() : absolute), direction })
  }
  return result
}

function investmentEntry(input: {
  source: ExtractedStatementSource & { format: "PDF" }
  page: ExtractedPdfPage
  postingDate?: string
  amount: string
  kind: CanonicalInvestmentEntry["kind"]
  description: string
  index: number
}): CanonicalInvestmentEntry {
  return {
    investmentId: `inv-${input.index}`,
    ...(input.postingDate ? { postingDate: input.postingDate } : {}),
    amount: money(parseMoney(input.amount)),
    kind: input.kind,
    description: input.description,
    provenance: createSourceProvenance({
      sourceId: input.source.sourceId,
      format: "PDF",
      adapterId: "BB_RENDE_FACIL_RESUMO",
      adapterVersion: "1",
      rawHash: input.source.sha256,
      extractionMethod: input.page.method,
      page: input.page.page,
    }),
  }
}

function validateBalanceEquation(
  openingBalance: string | undefined,
  closingBalance: string | undefined,
  transactions: readonly CanonicalBankTransaction[],
  issues: ImportIssue[],
): void {
  if (!openingBalance || !closingBalance || !transactions.length) return
  const expected = transactions.reduce((balance, transaction) => balance.plus(parseMoney(transaction.amount)), parseMoney(openingBalance))
  if (!expected.eq(parseMoney(closingBalance))) addIssue(issues, { severity: "ERROR", code: "BALANCE_INTEGRITY_FAILED", message: "Saldo anterior, movimentos e saldo final do Banco do Brasil não fecham." })
}

function bankIdentity(agency: string | undefined, account: string | undefined): CanonicalStatementDocument["identity"] {
  return {
    bankCode: BANK_CODE,
    bankName: "BANCO DO BRASIL",
    ...(agency ? { agency: { raw: agency, normalized: agency.replace(/\D/g, "") } } : {}),
    ...(account ? { account: { raw: account, normalized: account.replace(/\D/g, "") } } : {}),
  }
}

function validateRequiredFields(document: CanonicalStatementDocument, issues: ImportIssue[]): void {
  if (!document.identity.agency || !document.identity.account) addIssue(issues, { severity: "ERROR", code: "BANK_IDENTITY_MISSING", message: "Agência ou conta do Banco do Brasil não detectada." })
  if (!document.period) addIssue(issues, { severity: "ERROR", code: "STATEMENT_PERIOD_MISSING", message: "Período do Banco do Brasil não detectado." })
  if (!document.closingBalance) addIssue(issues, { severity: "ERROR", code: "CLOSING_BALANCE_MISSING", message: "Saldo final do Banco do Brasil não detectado." })
}

function monthPeriod(referenceDate: string): { start: string; end: string } {
  const [yearText, monthText] = referenceDate.split("-")
  const year = Number(yearText)
  const month = Number(monthText)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { start: `${yearText}-${monthText}-01`, end: `${yearText}-${monthText}-${String(lastDay).padStart(2, "0")}` }
}

function isCurrentDescriptionContinuation(line: string): boolean {
  return Boolean(line)
    && !/^\d{2}\/\d{2}\/\d{4}\b/.test(line)
    && !/^(?:INVEST\.|SALDO|JUROS|IOF|DATA DE DEBITO|BB RENDE FACIL|HTTPS?:|\*\*\*)\b/i.test(line)
}

function detection(bankMatched: boolean, layoutMatched: boolean, signatures: readonly string[]): StatementSourceDetection {
  return {
    matched: bankMatched && layoutMatched,
    score: bankMatched && layoutMatched ? 100 : (bankMatched ? 20 : 0) + (layoutMatched ? 20 : 0),
    evidenceCodes: signatures.filter((_, index) => index === 0 ? bankMatched : layoutMatched).map((signature) => `SIGNATURE:${signature}`),
  }
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
