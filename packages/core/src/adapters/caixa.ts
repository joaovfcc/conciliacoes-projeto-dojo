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

const BANK_CODE = "104"
const MONEY_TOKEN = "(?:\\d{1,3}(?:\\.\\d{3})*|\\d+),\\d{2}"

type MarkedAmount = {
  raw: string
  amount: string
  direction: "DEBIT" | "CREDIT"
}

export const caixaCurrentAccountAdapter: StatementSourceAdapter<"PDF"> = {
  adapterId: "CAIXA_CC_EXTRATO_PERIODO",
  adapterVersion: "1",
  format: "PDF",
  institutionCode: BANK_CODE,
  documentType: "CURRENT_ACCOUNT",
  layoutFamily: "CAIXA_CC_EXTRATO_PERIODO",

  detect(source): StatementSourceDetection {
    const upper = normalizeAscii(joinPages(source)).toUpperCase()
    const bankMatched = upper.includes("GERENCIADOR CAIXA") || upper.includes("SAC CAIXA") || upper.includes("CAIXA.GOV.BR")
    const layoutMatched = upper.includes("EXTRATO POR PERIODO")
    const identityMatched = /CONTA\s*:\s*[\d-]+\s*\|\s*[\d-]+\s*\|\s*[\d-]+/.test(upper)
    const columnsMatched = upper.includes("DATA MOV. NR. DOC. HISTORICO")
    const matched = bankMatched && layoutMatched && identityMatched && columnsMatched
    return {
      matched,
      score: matched ? 100 : [bankMatched, layoutMatched, identityMatched, columnsMatched].filter(Boolean).length * 15,
      evidenceCodes: [
        ...(bankMatched ? ["SIGNATURE:CAIXA"] : []),
        ...(layoutMatched ? ["SIGNATURE:EXTRATO POR PERIODO"] : []),
        ...(identityMatched ? ["SIGNATURE:CONTA CAIXA"] : []),
        ...(columnsMatched ? ["SIGNATURE:COLUNAS CAIXA"] : []),
      ],
    }
  },

  parse(source): CanonicalStatementDocument {
    const normalizedText = normalizeAscii(joinPages(source))
    const identityMatch = /CONTA\s*:\s*([\d-]+)\s*\|\s*([\d-]+)\s*\|\s*([\d-]+)/i.exec(normalizedText)
    const period = extractCurrentPeriod(normalizedText)
    const transactions: CanonicalBankTransaction[] = []
    const issues: ImportIssue[] = []
    let openingBalance: string | undefined
    let closingBalance: string | undefined
    let expectedBalance: ReturnType<typeof parseMoney> | undefined
    let dailyControlCount = 0

    for (const page of source.pages ?? []) {
      for (const rawLine of splitLines(page.text)) {
        const line = normalizeAscii(rawLine)
        const controls = markedAmounts(line)

        if (/^\d{6}\s+SALDO\s+ANTERIOR\b/i.test(line)) {
          const opening = controls.at(-1)
          if (opening) {
            openingBalance = opening.amount
            expectedBalance = parseMoney(opening.amount)
          }
          continue
        }

        const dated = /^(\d{2}\/\d{2}\/\d{4})\s+(\d{6})\s+(.+)$/i.exec(line)
        if (!dated?.[1] || !dated[2] || !dated[3]) continue

        if (/\bSALDO\s+DIA\b/i.test(dated[3])) {
          const control = controls.at(-1)
          if (control) {
            dailyControlCount += 1
            closingBalance = control.amount
            if (!expectedBalance || !expectedBalance.eq(parseMoney(control.amount))) addBalanceIssue(issues)
          }
          continue
        }

        const movement = controls[0]
        const runningBalance = controls[1]
        if (!movement || !runningBalance) {
          addIssue(issues, {
            severity: "ERROR",
            code: "STATEMENT_ROW_INCOMPLETE",
            message: "Uma linha da Caixa não contém valor e saldo com marcadores C/D completos.",
          })
          continue
        }
        const descriptionEnd = line.indexOf(movement.raw)
        const descriptionPrefix = line.slice(0, descriptionEnd).trim()
        const normalizedDescription = /^\d{2}\/\d{2}\/\d{4}\s+\d{6}\s+(.+)$/i.exec(descriptionPrefix)?.[1]?.trim() ?? ""
        if (!normalizedDescription) {
          addIssue(issues, {
            severity: "ERROR",
            code: "STATEMENT_ROW_INCOMPLETE",
            message: "Uma linha da Caixa não contém histórico identificável.",
          })
          continue
        }
        expectedBalance = expectedBalance?.plus(parseMoney(movement.amount))
        if (!expectedBalance || !expectedBalance.eq(parseMoney(runningBalance.amount))) addBalanceIssue(issues)

        transactions.push({
          transactionId: `tx-${transactions.length + 1}`,
          postingDate: parseDate(dated[1]),
          documentNumber: dated[2],
          amount: movement.amount,
          direction: movement.direction,
          description: normalizedDescription,
          runningBalance: runningBalance.amount,
          provenance: createSourceProvenance({
            sourceId: source.sourceId,
            format: "PDF",
            adapterId: "CAIXA_CC_EXTRATO_PERIODO",
            adapterVersion: "1",
            rawHash: source.sha256,
            extractionMethod: page.method,
            page: page.page,
          }),
        })
      }
    }

    if (transactions.length && dailyControlCount === 0) {
      addIssue(issues, {
        severity: "ERROR",
        code: "DAILY_BALANCE_CONTROL_MISSING",
        message: "O extrato da Caixa não apresenta controle de saldo diário.",
      })
    }
    if (closingBalance && expectedBalance && !expectedBalance.eq(parseMoney(closingBalance))) addBalanceIssue(issues)

    return {
      sourceId: source.sourceId,
      format: "PDF",
      institutionCode: BANK_CODE,
      documentType: "CURRENT_ACCOUNT",
      layoutFamily: "CAIXA_CC_EXTRATO_PERIODO",
      adapterId: "CAIXA_CC_EXTRATO_PERIODO",
      adapterVersion: "1",
      identity: caixaIdentity(identityMatch?.[1], identityMatch?.[3]),
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
    if (!document.openingBalance) addIssue(issues, { severity: "ERROR", code: "OPENING_BALANCE_MISSING", message: "Saldo anterior da Caixa não detectado." })
    if (!document.transactions.length) addIssue(issues, { severity: "ERROR", code: "STATEMENT_MOVEMENTS_NOT_EXTRACTED", message: "Nenhum movimento da Caixa foi extraído." })
    return validationResult(issues)
  },
}

export const caixaFundStatementAdapter: StatementSourceAdapter<"PDF"> = {
  adapterId: "CAIXA_FUNDO_EXTRATO",
  adapterVersion: "1",
  format: "PDF",
  institutionCode: BANK_CODE,
  documentType: "FUND_STATEMENT",
  layoutFamily: "CAIXA_FUNDO_EXTRATO",

  detect(source): StatementSourceDetection {
    const upper = normalizeAscii(joinPages(source)).toUpperCase()
    return exactDetection(upper, [
      "CAIXA - EXTRATO DE FUNDOS",
      "EXTRATO FUNDO DE INVESTIMENTO",
      "RESUMO DA MOVIMENTACAO",
    ])
  },

  parse(source): CanonicalStatementDocument {
    const normalizedText = normalizeAscii(joinPages(source))
    const fundIdentity = extractFundIdentity(source)
    const agency = extractFundAgency(source)
    const period = fundIdentity?.period
    const summary = extractFundSummary(source)
    const investments: CanonicalInvestmentEntry[] = []
    const issues: ImportIssue[] = []
    let detailedApplications = parseMoney("0")
    let detailedRedemptions = parseMoney("0")
    let inDetails = false

    for (const page of source.pages ?? []) {
      for (const rawLine of splitLines(page.text)) {
        const line = normalizeAscii(rawLine)
        if (/^MOVIMENTACAO\s+DETALHADA$/i.test(line)) {
          inDetails = true
          continue
        }
        if (!inDetails) continue
        const movement = new RegExp(`^(\\d{2})\\s*\\/\\s*(\\d{2})\\s+(APLICACAO|RESGATE)\\s+(${MONEY_TOKEN})\\s*([CD])`, "i").exec(line)
        if (!movement?.[1] || !movement[2] || !movement[3] || !movement[4]) continue
        const amount = parseMoney(movement[4]).abs()
        const kind = movement[3].toUpperCase() === "APLICACAO" ? "APPLICATION" : "REDEMPTION"
        if (kind === "APPLICATION") detailedApplications = detailedApplications.plus(amount)
        else detailedRedemptions = detailedRedemptions.plus(amount)
        investments.push(fundEntry({
          source,
          page,
          index: investments.length + 1,
          ...(period ? { postingDate: `${period.start.slice(0, 4)}-${movement[2]}-${movement[1]}` } : {}),
          amount: money(amount),
          kind,
          description: kind === "APPLICATION" ? "CAIXA FUNDO - APLICAÇÃO" : "CAIXA FUNDO - RESGATE",
        }))
      }
    }

    if (summary) {
      const expectedClosing = summary.opening
        .plus(summary.applications)
        .minus(summary.redemptions)
        .plus(summary.earnings)
        .minus(summary.irrf)
        .minus(summary.iof)
        .minus(summary.exitFee)
      if (!expectedClosing.eq(summary.closing)) addBalanceIssue(issues)
      if (!detailedApplications.eq(summary.applications) || !detailedRedemptions.eq(summary.redemptions)) {
        addIssue(issues, {
          severity: "ERROR",
          code: "INVESTMENT_SUMMARY_MISMATCH",
          message: "Os movimentos detalhados do fundo Caixa divergem dos totais de aplicações ou resgates.",
        })
      }

      const evidencePage = source.pages?.[0]
      if (evidencePage && !summary.earnings.isZero()) investments.push(fundEntry({
        source,
        page: evidencePage,
        index: investments.length + 1,
        ...(period ? { postingDate: period.end } : {}),
        amount: money(summary.earnings),
        kind: "EARNING",
        description: "CAIXA FUNDO - RENDIMENTO BRUTO DO MÊS",
      }))
      if (evidencePage && !summary.closing.isZero()) investments.push(fundEntry({
        source,
        page: evidencePage,
        index: investments.length + 1,
        ...(period ? { postingDate: period.end } : {}),
        amount: money(summary.closing),
        kind: "POSITION",
        description: "CAIXA FUNDO - POSIÇÃO FINAL",
      }))
    }

    issues.push({
      severity: "WARNING",
      code: "FUNDO_INVESTIMENTO_INFORMATIVO",
      message: "O extrato de fundo da Caixa é informativo e não será conciliado com o razão.",
    })

    return {
      sourceId: source.sourceId,
      format: "PDF",
      institutionCode: BANK_CODE,
      documentType: "FUND_STATEMENT",
      layoutFamily: "CAIXA_FUNDO_EXTRATO",
      adapterId: "CAIXA_FUNDO_EXTRATO",
      adapterVersion: "1",
      identity: caixaIdentity(agency, fundIdentity?.account),
      ...(period ? { period } : {}),
      transactions: [],
      investments,
      ...(summary ? { openingBalance: money(summary.opening), closingBalance: money(summary.closing) } : {}),
      issues,
    }
  },

  validate(document): StatementSourceValidation {
    const issues = [...document.issues]
    validateRequiredFields(document, issues)
    if (!document.investments?.length) addIssue(issues, { severity: "ERROR", code: "INVESTMENT_MOVEMENTS_NOT_EXTRACTED", message: "Nenhuma movimentação ou posição do fundo Caixa foi extraída." })
    return validationResult(issues)
  },
}

function extractFundSummary(source: ExtractedStatementSource): {
  opening: ReturnType<typeof parseMoney>
  applications: ReturnType<typeof parseMoney>
  redemptions: ReturnType<typeof parseMoney>
  earnings: ReturnType<typeof parseMoney>
  irrf: ReturnType<typeof parseMoney>
  iof: ReturnType<typeof parseMoney>
  exitFee: ReturnType<typeof parseMoney>
  closing: ReturnType<typeof parseMoney>
} | undefined {
  const lines = splitLines(joinPages(source)).map(normalizeAscii)
  const value = (pattern: RegExp): ReturnType<typeof parseMoney> | undefined => {
    const line = lines.find((candidate) => pattern.test(candidate))
    if (!line) return undefined
    const match = new RegExp(`(${MONEY_TOKEN})`).exec(line)
    return match?.[1] ? parseMoney(match[1]).abs() : undefined
  }
  const opening = value(/^SALDO\s+ANTERIOR\b/i)
  const applications = value(/^APLICACOES\b/i)
  const redemptions = value(/^RESGATES\b/i)
  const earnings = value(/^RENDIMENTO\s+BRUTO\s+NO\s+MES\b/i)
  const irrf = value(/^IRRF\b/i)
  const iof = value(/^IOF\b/i)
  const exitFee = value(/^TAXA\s+DE\s+SAIDA\b/i)
  const closing = value(/^SALDO\s+BRUTO\*/i)
  return opening && applications && redemptions && earnings && irrf && iof && exitFee && closing
    ? { opening, applications, redemptions, earnings, irrf, iof, exitFee, closing }
    : undefined
}

function extractFundAgency(source: ExtractedStatementSource): string | undefined {
  const lines = splitLines(joinPages(source)).map(normalizeAscii)
  const headerIndex = lines.findIndex((line) => /NOME\s+DA\s+AGENCIA\s+CODIGO\s+OPERACAO\s+EMISSAO/i.test(line))
  if (headerIndex < 0) return undefined
  const match = /^.+?\s+(\d{4})\s+\d{4}\s+\d{2}\/\d{2}\/\d{4}$/.exec(lines[headerIndex + 1] ?? "")
  return match?.[1]
}

function extractFundIdentity(source: ExtractedStatementSource): {
  account: string
  period: { start: string; end: string }
} | undefined {
  const lines = splitLines(joinPages(source)).map(normalizeAscii)
  const headerIndex = lines.findIndex((line, index) => /CPF\/CNPJ\s+CONTA\s+CORRENTE/i.test(line)
    && (/MES\/ANO\s+FOLHA/i.test(line) || /MES\/ANO\s+FOLHA/i.test(lines[index + 1] ?? "")))
  if (headerIndex < 0) return undefined
  const splitHeader = !/MES\/ANO\s+FOLHA/i.test(lines[headerIndex] ?? "")
  const clientBlock = lines.slice(headerIndex + (splitHeader ? 2 : 1), headerIndex + 10)
  const fullText = clientBlock.join("\n")
  const fullMatch = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\s+([\d.]+-\d)\s+(\d{2}\/\d{4})/i.exec(fullText)
  if (fullMatch?.[1] && fullMatch[2]) {
    const period = monthPeriod(fullMatch[2])
    return period ? { account: fullMatch[1], period } : undefined
  }

  const partialLineIndex = clientBlock.findIndex((line) => /\d{2}\.\d{3}\.\d{3}\/\d{4}-\s+[\d.]+-$/.test(line))
  if (partialLineIndex < 0) return undefined
  const partialLine = clientBlock[partialLineIndex]!
  const accountPrefix = /([\d.]+-)$/.exec(partialLine)?.[1]
  const periodText = clientBlock.slice(partialLineIndex + 1).map((line) => /(\d{2}\/\d{4})\s+\d{2}\/\d{2}/.exec(line)?.[1]).find(Boolean)
  const accountDigit = clientBlock.slice(partialLineIndex + 1).map((line) => /\b\d{2}\s+(\d)\s*$/.exec(line)?.[1]).find(Boolean)
  const period = periodText ? monthPeriod(periodText) : undefined
  return accountPrefix && accountDigit && period
    ? { account: `${accountPrefix}${accountDigit}`, period }
    : undefined
}

function fundEntry(input: {
  source: ExtractedStatementSource & { format: "PDF" }
  page: ExtractedPdfPage
  index: number
  postingDate?: string
  amount: string
  kind: CanonicalInvestmentEntry["kind"]
  description: string
}): CanonicalInvestmentEntry {
  return {
    investmentId: `inv-${input.index}`,
    ...(input.postingDate ? { postingDate: input.postingDate } : {}),
    amount: input.amount,
    kind: input.kind,
    description: input.description,
    provenance: createSourceProvenance({
      sourceId: input.source.sourceId,
      format: "PDF",
      adapterId: "CAIXA_FUNDO_EXTRATO",
      adapterVersion: "1",
      rawHash: input.source.sha256,
      extractionMethod: input.page.method,
      page: input.page.page,
    }),
  }
}

function markedAmounts(line: string): MarkedAmount[] {
  const amounts: MarkedAmount[] = []
  const pattern = new RegExp(`(${MONEY_TOKEN})\\s*([CD])\\b`, "gi")
  for (const match of line.matchAll(pattern)) {
    if (!match[0] || !match[1] || !match[2]) continue
    const direction = match[2].toUpperCase() === "D" ? "DEBIT" : "CREDIT"
    const absolute = parseMoney(match[1]).abs()
    amounts.push({
      raw: match[0],
      direction,
      amount: money(direction === "DEBIT" ? absolute.negated() : absolute),
    })
  }
  return amounts
}

function extractCurrentPeriod(text: string): { start: string; end: string } | undefined {
  const monthMatch = /MES\s*:\s*([A-Z]+)\/(\d{4})/i.exec(text)
  const daysMatch = /PERIODO\s*:\s*(\d{1,2})\s*-\s*(\d{1,2})/i.exec(text)
  if (!monthMatch?.[1] || !monthMatch[2] || !daysMatch?.[1] || !daysMatch[2]) return undefined
  const month = portugueseMonth(monthMatch[1])
  if (!month) return undefined
  return {
    start: `${monthMatch[2]}-${month}-${daysMatch[1].padStart(2, "0")}`,
    end: `${monthMatch[2]}-${month}-${daysMatch[2].padStart(2, "0")}`,
  }
}

function portugueseMonth(value: string): string | undefined {
  const months: Record<string, string> = {
    JANEIRO: "01", FEVEREIRO: "02", MARCO: "03", ABRIL: "04", MAIO: "05", JUNHO: "06",
    JULHO: "07", AGOSTO: "08", SETEMBRO: "09", OUTUBRO: "10", NOVEMBRO: "11", DEZEMBRO: "12",
  }
  return months[value.toUpperCase()]
}

function monthPeriod(value: string): { start: string; end: string } | undefined {
  const match = /^(\d{2})\/(\d{4})$/.exec(value)
  if (!match?.[1] || !match[2]) return undefined
  const lastDay = new Date(Date.UTC(Number(match[2]), Number(match[1]), 0)).getUTCDate()
  return { start: `${match[2]}-${match[1]}-01`, end: `${match[2]}-${match[1]}-${String(lastDay).padStart(2, "0")}` }
}

function caixaIdentity(agency: string | undefined, account: string | undefined): CanonicalStatementDocument["identity"] {
  return {
    bankCode: BANK_CODE,
    bankName: "CAIXA",
    ...(agency ? { agency: { raw: agency, normalized: agency.replace(/\D/g, "") } } : {}),
    ...(account ? { account: { raw: account, normalized: account.replace(/\D/g, "") } } : {}),
  }
}

function validateRequiredFields(document: CanonicalStatementDocument, issues: ImportIssue[]): void {
  if (!document.identity.agency || !document.identity.account) addIssue(issues, { severity: "ERROR", code: "BANK_IDENTITY_MISSING", message: "Agência ou conta da Caixa não detectada." })
  if (!document.period) addIssue(issues, { severity: "ERROR", code: "STATEMENT_PERIOD_MISSING", message: "Período do documento Caixa não detectado." })
  if (!document.closingBalance) addIssue(issues, { severity: "ERROR", code: "CLOSING_BALANCE_MISSING", message: "Saldo final do documento Caixa não detectado." })
}

function addBalanceIssue(issues: ImportIssue[]): void {
  addIssue(issues, { severity: "ERROR", code: "BALANCE_INTEGRITY_FAILED", message: "Os movimentos e controles de saldo da Caixa não fecham." })
}

function exactDetection(text: string, signatures: readonly string[]): StatementSourceDetection {
  const matches = signatures.filter((signature) => text.includes(signature))
  const matched = matches.length === signatures.length
  return {
    matched,
    score: matched ? 100 : matches.length * 20,
    evidenceCodes: matches.map((signature) => `SIGNATURE:${signature}`),
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
