/**
 * Shared PDF adapter utilities.
 *
 * These functions are extracted from the monolithic `files.ts` to be reused
 * by individual V2 adapter implementations. They handle text normalization,
 * line splitting, bank identity extraction, record construction and
 * result assembly for PDF-based bank statement parsing.
 */

import { createHash } from "node:crypto"
import { calculateBalanceCheck } from "../balance.js"
import { normalizeDocument, parseDate, parseMoney, periodOf, money } from "../normalization.js"
import type {
  DetectedStatement,
  ExtractionMethod,
  ImportIssue,
  InvestmentEntry,
  StatementClassification,
  StatementRecord,
} from "../types.js"
import type { SourceFileInput, OcrPage } from "../index.js"

export type PdfPage = { page: number; text: string; confidence: string; method: ExtractionMethod }
export type PdfDetails = { bank: string; agency: string; account: string; periods: string[]; finalBalance?: string }
export type PdfStatementResult = { records: StatementRecord[]; investments: InvestmentEntry[]; metadata: DetectedStatement; issues: ImportIssue[] }

export function pageLines(text: string): string[] {
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

export function normalizeAscii(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

export function bankDetails(bank: string, text: string, matcher: RegExp): PdfDetails {
  const match = matcher.exec(normalizeAscii(text))
  const agency = match?.[1]?.replace(/\D/g, "") ?? ""
  const account =
    match?.[2]?.replace(/\s+/g, "").trim().replace(/\s+/g, "") ??
    match?.[1]?.replace(/\s+/g, "") ??
    ""
  return {
    bank,
    agency: matcher.source.includes("NUMERO") ? "" : agency,
    account,
    periods: periodsIn(text),
  }
}

export function periodsIn(text: string): string[] {
  const values = [...text.matchAll(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/g)].map(
    (match) => `${match[3]}${match[2]}`,
  )
  return unique(values)
}

export function pdfRecord(
  file: SourceFileInput,
  page: PdfPage,
  line: number,
  data: {
    date: string
    document: string
    history: string
    value: string
    runningBalance?: string
    bank: string
    agency: string
    account: string
    parser: string
  },
): StatementRecord {
  return statementRecord(file, `${page.page}:${line}`, {
    ...data,
    date: parseDate(data.date),
    value: money(parseMoney(data.value)),
    ...(data.runningBalance
      ? { runningBalance: money(parseMoney(data.runningBalance)) }
      : {}),
    sourceId: "",
    extractionMethod: page.method,
    page: page.page,
    sourceText: data.history,
    confidence: page.confidence,
  })
}

export function investmentEntry(
  file: SourceFileInput,
  page: PdfPage,
  line: number,
  details: PdfDetails,
  kind: InvestmentEntry["kind"],
  amount: string,
  description: string,
  parser: string,
  date?: string,
): InvestmentEntry {
  return {
    id: stableId("INVESTMENT", file.id, `${page.page}:${line}:${kind}`),
    fileId: file.id,
    originalName: file.originalName,
    bank: details.bank,
    agency: details.agency,
    account: details.account,
    ...(date ? { date: parseDate(date) } : {}),
    kind,
    amount: money(parseMoney(amount)),
    description,
    evidence: {
      fileId: file.id,
      originalName: file.originalName,
      page: page.page,
      line,
      sourceText: description,
      extractionMethod: page.method,
      parser,
      confidence: page.confidence,
    },
  }
}

export function extractionMethodOf(pages: PdfPage[]): ExtractionMethod {
  return pages.some((item) => item.method === "OCR") &&
    pages.some((item) => item.method === "TEXT")
    ? "MIXED"
    : pages.some((item) => item.method === "OCR")
      ? "OCR"
      : "TEXT"
}

export function currentAccountResult(
  file: SourceFileInput,
  records: StatementRecord[],
  details: PdfDetails,
  method: ExtractionMethod,
  confidences: string[],
  parser: string,
  documentText: string,
): PdfStatementResult {
  const normalizedText = normalizeAscii(documentText).toUpperCase()
  const hasExplicitNoMovements =
    normalizedText.includes("SEM MOVIMENT") ||
    normalizedText.includes("NAO HOUVE LANC") ||
    normalizedText.includes("SEM TRANSAC")
  const balanceCheck = calculateBalanceCheck(
    records.map((record) => ({
      amount: record.value,
      ...(record.runningBalance ? { runningBalance: record.runningBalance } : {}),
    })),
  )
  const issues: ImportIssue[] = records.length
    ? []
    : hasExplicitNoMovements
      ? [
          issue(
            "WARNING",
            "EXTRATO_SEM_MOVIMENTOS",
            "O extrato declara explicitamente que não houve lançamentos no período.",
            file.id,
          ),
        ]
      : [
          issue(
            "ERROR",
            "STATEMENT_MOVEMENTS_NOT_EXTRACTED",
            "O extrato não possui movimentos extraídos nem uma declaração explícita de ausência de lançamentos.",
            file.id,
          ),
        ]
  if (balanceCheck.status === "FAILED")
    issues.push(
      issue(
        "ERROR",
        "BALANCE_INTEGRITY_FAILED",
        "Os saldos acumulados extraídos não são compatíveis com os movimentos do extrato.",
        file.id,
      ),
    )
  else if (records.length && balanceCheck.status === "NOT_AVAILABLE")
    issues.push(
      issue(
        "WARNING",
        "BALANCE_CONTROL_NOT_AVAILABLE",
        "O layout não forneceu saldos acumulados suficientes para validar a completude matemática.",
        file.id,
      ),
    )
  return {
    records,
    investments: [],
    metadata: detectedStatement(
      file,
      details,
      records,
      method,
      confidences,
      parser,
      "CURRENT_ACCOUNT",
      true,
    ),
    issues,
  }
}

export function investmentResult(
  file: SourceFileInput,
  investments: InvestmentEntry[],
  details: PdfDetails,
  method: ExtractionMethod,
  confidences: string[],
  parser: string,
  classification: StatementClassification,
): PdfStatementResult {
  const message =
    classification === "INVESTMENT_POSITION"
      ? "O documento contém uma posição de investimento para conferência e não será conciliado lançamento a lançamento."
      : "Os movimentos de investimento são informativos e não serão conciliados com o razão."
  const periods = unique(
    investments.flatMap((item) => (item.date ? [periodOf(item.date)] : [])),
  )
  return {
    records: [],
    investments,
    metadata: detectedStatement(
      file,
      {
        ...details,
        periods: periods.length ? periods : details.periods,
      },
      [],
      method,
      confidences,
      parser,
      classification,
      false,
      investments.length,
    ),
    issues: [
      issue(
        "WARNING",
        classification === "INVESTMENT_POSITION"
          ? "POSICAO_INVESTIMENTO_INFORMATIVA"
          : "MOVIMENTOS_INVESTIMENTO_INFORMATIVOS",
        message,
        file.id,
      ),
    ],
  }
}

export function parseSingleLineRecords(
  file: SourceFileInput,
  pages: PdfPage[],
  details: PdfDetails,
  parser: string,
  pattern: RegExp,
  shouldSkip: (line: string) => boolean = (line) => /\bSALDO\b/i.test(line),
): StatementRecord[] {
  const records: StatementRecord[] = []
  const year = inferYear(pages.map((page) => page.text).join("\n"))
  for (const page of pages)
    for (const [index, line] of pageLines(page.text).entries()) {
      if (shouldSkip(line)) continue
      const match = pattern.exec(line)
      if (!match) continue
      const rawDate = match[1]!
      const date = rawDate.length === 5 ? `${rawDate}/${year}` : rawDate
      const negative = match[4] === "-" || match[3]!.startsWith("-")
      const body = match[2]!.trim().split(/\s+/)
      const document = /^\d{4,8}$/.test(body.at(-1) ?? "") ? body.pop()! : ""
      records.push(
        pdfRecord(file, page, index + 1, {
          date,
          document,
          history: body.join(" "),
          value: `${negative ? "-" : ""}${match[3]!.replace(/^-/, "")}`,
          bank: details.bank,
          agency: details.agency,
          account: details.account,
          parser,
        }),
      )
    }
  return records
}

export function parseDatedInvestmentRows(
  file: SourceFileInput,
  pages: PdfPage[],
  details: PdfDetails,
  parser: string,
  classify: (line: string) => InvestmentEntry["kind"] | undefined,
): InvestmentEntry[] {
  const entries: InvestmentEntry[] = []
  for (const page of pages)
    for (const [index, line] of pageLines(page.text).entries()) {
      const kind = classify(line)
      const date = /^(\d{2}\/\d{2}\/\d{4})/.exec(line)?.[1]
      const values = line.match(/-?[\d.]+,\d{2}/g) ?? []
      if (!kind || !date || !values.length) continue
      entries.push(
        investmentEntry(
          file,
          page,
          index + 1,
          details,
          kind,
          values[0]!,
          kind === "APPLICATION"
            ? "Aplicação"
            : kind === "REDEMPTION"
              ? "Resgate/Vencimento"
              : "Rendimento",
          parser,
          date,
        ),
      )
    }
  return entries
}

export function inferYear(text: string): string {
  const match = /(?:20)\d{2}/.exec(text)
  return match?.[0] ?? String(new Date().getUTCFullYear())
}

export function isZero(value: string): boolean {
  return parseMoney(value).isZero()
}

// --- internal helpers ---

function detectedStatement(
  file: SourceFileInput,
  details: PdfDetails,
  records: StatementRecord[],
  method: ExtractionMethod,
  confidences: string[],
  parser: string,
  classification: StatementClassification,
  reconciliationEligible: boolean,
  recordCount = records.length,
): DetectedStatement {
  const confidence = confidences.length
    ? money(
        confidences.reduce((sum, item) => sum + Number(item), 0) /
          confidences.length,
      )
    : undefined
  const recordPeriods = unique(records.map((item) => periodOf(item.date)))
  const detailPeriods = details.periods.filter((item) => /^\d{6}$/.test(item))
  return {
    fileId: file.id,
    originalName: file.originalName,
    bank: details.bank,
    agency: details.agency,
    account: details.account,
    periods: recordPeriods.length ? recordPeriods : detailPeriods,
    recordCount,
    extractionMethod: method,
    parser,
    classification,
    reconciliationEligible,
    balanceCheck: calculateBalanceCheck(
      records.map((record) => ({
        amount: record.value,
        ...(record.runningBalance
          ? { runningBalance: record.runningBalance }
          : {}),
      })),
    ),
    ...(details.finalBalance
      ? { finalBalance: money(parseMoney(details.finalBalance)) }
      : {}),
    ...(confidence ? { confidence } : {}),
  }
}

function statementRecord(
  file: SourceFileInput,
  position: number | string,
  data: {
    date: string
    document: string
    history: string
    value: string
    sourceId: string
    bank: string
    agency: string
    account: string
    extractionMethod: ExtractionMethod
    parser: string
    runningBalance?: string
    page?: number
    sourceText?: string
    confidence?: string
  },
): StatementRecord {
  return {
    id: stableId("STATEMENT", file.id, position),
    bank: data.bank,
    agency: data.agency,
    bankAccount: data.account,
    date: data.date,
    document: data.document,
    history: data.history,
    value: data.value,
    ...(data.runningBalance ? { runningBalance: data.runningBalance } : {}),
    sourceId:
      data.sourceId || stableId("SOURCE", file.id, position),
    evidence: {
      fileId: file.id,
      originalName: file.originalName,
      extractionMethod: data.extractionMethod,
      parser: data.parser,
      ...(typeof position === "number" ? { line: position } : {}),
      ...(data.page ? { page: data.page } : {}),
      ...(data.sourceText ? { sourceText: data.sourceText } : {}),
      ...(data.confidence ? { confidence: data.confidence } : {}),
    },
  }
}

function stableId(prefix: string, fileId: string, position: string | number): string {
  return `${prefix}-${createHash("sha256").update(`${fileId}|${position}`).digest("hex").slice(0, 16)}`
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function issue(
  severity: "WARNING" | "ERROR",
  code: string,
  message: string,
  fileId?: string,
  sourcePosition?: string,
): ImportIssue {
  return {
    severity,
    code,
    message,
    ...(fileId ? { fileId } : {}),
    ...(sourcePosition ? { sourcePosition } : {}),
  }
}
