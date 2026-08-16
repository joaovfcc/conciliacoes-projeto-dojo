import { money, parseDate, parseMoney } from "../normalization.js"
import {
  type CanonicalStatementDocument,
  type ExtractedStatementSource,
  type StatementSourceAdapter,
  type StatementSourceDetection,
  type StatementSourceValidation,
} from "../statement-sources.js"
import type { ImportIssue } from "../types.js"

const BANK_CODE = "612"
const MONEY_TOKEN = "(?:\\d{1,3}(?:\\.\\d{3})*|\\d+),\\d{2}"

export const guanabaraCurrentAccountAdapter: StatementSourceAdapter<"PDF"> = guanabaraAdapter({
  adapterId: "GUANABARA_CC",
  title: "EXTRATO DE CONTA CORRENTE",
})

export const guanabaraLinkedAccountAdapter: StatementSourceAdapter<"PDF"> = guanabaraAdapter({
  adapterId: "GUANABARA_CONTA_VINCULADA",
  title: "EXTRATO DE CONTA VINCULADA",
})

function guanabaraAdapter(input: { adapterId: "GUANABARA_CC" | "GUANABARA_CONTA_VINCULADA"; title: string }): StatementSourceAdapter<"PDF"> {
  return {
    adapterId: input.adapterId,
    adapterVersion: "1",
    format: "PDF",
    institutionCode: BANK_CODE,
    documentType: "CURRENT_ACCOUNT",
    layoutFamily: input.adapterId,

    detect(source): StatementSourceDetection {
      const upper = normalizeAscii(joinPages(source)).toUpperCase()
      const bankMatched = upper.includes("BANCO GUANABARA")
      const codeMatched = /CODIGO\s+BANCO\s*:\s*612\b/.test(upper)
      const layoutMatched = upper.includes(input.title)
      const matched = bankMatched && codeMatched && layoutMatched
      return {
        matched,
        score: matched ? 100 : [bankMatched, codeMatched, layoutMatched].filter(Boolean).length * 20,
        evidenceCodes: [
          ...(bankMatched ? ["SIGNATURE:BANCO GUANABARA"] : []),
          ...(codeMatched ? ["SIGNATURE:CODIGO 612"] : []),
          ...(layoutMatched ? [`SIGNATURE:${input.title}`] : []),
        ],
      }
    },

    parse(source): CanonicalStatementDocument {
      const text = normalizeAscii(joinPages(source))
      const agency = /AGENCIA\s*:\s*([\d-]+)/i.exec(text)?.[1]
      const account = /CONTA\s*:\s*([\d-]+)/i.exec(text)?.[1]
      const periodMatch = /NAO\s+HOUVE\s+MOVIMENTACOES\s+NO\s+PERIODO\s+DE\s+(\d{2}\/\d{2}\/\d{4})\s+ATE\s+(\d{2}\/\d{2}\/\d{4})/i.exec(text)
      const closingMatch = new RegExp(`SALDO\\s+EM\\s+\\d{2}\\/\\d{2}\\/\\d{4}\\s+(${MONEY_TOKEN})`, "i").exec(text)
      const declaresNoMovements = Boolean(periodMatch?.[1] && periodMatch[2])

      return {
        sourceId: source.sourceId,
        format: "PDF",
        institutionCode: BANK_CODE,
        documentType: "CURRENT_ACCOUNT",
        layoutFamily: input.adapterId,
        adapterId: input.adapterId,
        adapterVersion: "1",
        identity: {
          bankCode: BANK_CODE,
          bankName: "GUANABARA",
          ...(agency ? { agency: { raw: agency, normalized: agency.replace(/\D/g, "") } } : {}),
          ...(account ? { account: { raw: account, normalized: account.replace(/\D/g, "") } } : {}),
        },
        ...(periodMatch?.[1] && periodMatch[2]
          ? { period: { start: parseDate(periodMatch[1]), end: parseDate(periodMatch[2]) } }
          : {}),
        transactions: [],
        ...(declaresNoMovements ? { declaresNoMovements: true } : {}),
        ...(closingMatch?.[1] ? { closingBalance: money(parseMoney(closingMatch[1])) } : {}),
        issues: [],
      }
    },

    validate(document): StatementSourceValidation {
      const issues = [...document.issues]
      if (!document.identity.agency || !document.identity.account) addIssue(issues, { severity: "ERROR", code: "BANK_IDENTITY_MISSING", message: "Agência ou conta do Banco Guanabara não detectada." })
      if (!document.period) addIssue(issues, { severity: "ERROR", code: "STATEMENT_PERIOD_MISSING", message: "Período do extrato Guanabara não detectado." })
      if (!document.closingBalance) addIssue(issues, { severity: "ERROR", code: "CLOSING_BALANCE_MISSING", message: "Saldo final do extrato Guanabara não detectado." })
      if (!document.declaresNoMovements) addIssue(issues, { severity: "ERROR", code: "STATEMENT_MOVEMENTS_NOT_EXTRACTED", message: "O extrato Guanabara não declara ausência de movimentações." })
      return { accepted: issues.every((issue) => issue.severity !== "ERROR"), issues }
    },
  }
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
