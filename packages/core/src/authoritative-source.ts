import Decimal from "decimal.js"

import type { ImportIssue } from "./types.js"
import type {
  CanonicalStatementDocument,
  SourceProcessingMode,
  StatementSourceFormat,
} from "./statement-sources.js"

export type CrosscheckDiagnostic = {
  field: string
  pdfValue: string
  csvValue: string
}

export type CrosscheckResult =
  | { status: "PASSED"; diagnostics: readonly CrosscheckDiagnostic[] }
  | { status: "NOT_PROVIDED" }
  | { status: "FAILED"; diagnostics: readonly CrosscheckDiagnostic[]; issues: readonly ImportIssue[] }

export type AuthoritativeSourceSelection = {
  mode: SourceProcessingMode
  authoritative: CanonicalStatementDocument
  secondary?: CanonicalStatementDocument
  crosscheck: CrosscheckResult
}

export type AuthoritativeSourceSelectionResult =
  | { status: "SELECTED"; selection: AuthoritativeSourceSelection }
  | { status: "NO_SOURCE" }

/**
 * Selects exactly one authoritative source of bank transactions.
 *
 * Rules (PRD V2 §4.2):
 * - PDF_PRIMARY: PDF homologated, no CSV or CSV used only for crosscheck
 * - CSV_PRIMARY: CSV homologated, PDF absent
 * - PDF_PRIMARY_CSV_CROSSCHECK: both present, PDF is authoritative, CSV validates
 * - Movements are NEVER merged between sources
 * - Default mode for V2 is PDF_PRIMARY
 */
export function selectAuthoritativeSource(
  pdfDocument?: CanonicalStatementDocument,
  csvDocument?: CanonicalStatementDocument,
): AuthoritativeSourceSelectionResult {
  if (!pdfDocument && !csvDocument) {
    return { status: "NO_SOURCE" }
  }

  if (pdfDocument && !csvDocument) {
    return {
      status: "SELECTED",
      selection: {
        mode: "PDF_PRIMARY",
        authoritative: pdfDocument,
        crosscheck: { status: "NOT_PROVIDED" },
      },
    }
  }

  if (!pdfDocument && csvDocument) {
    return {
      status: "SELECTED",
      selection: {
        mode: "CSV_PRIMARY",
        authoritative: csvDocument,
        crosscheck: { status: "NOT_PROVIDED" },
      },
    }
  }

  // Both present — PDF is authoritative, CSV is crosscheck
  const crosscheck = crosscheckSources(pdfDocument!, csvDocument!)
  return {
    status: "SELECTED",
    selection: {
      mode: "PDF_PRIMARY_CSV_CROSSCHECK",
      authoritative: pdfDocument!,
      secondary: csvDocument!,
      crosscheck,
    },
  }
}

/**
 * Compares two CanonicalStatementDocuments from independent sources
 * (typically PDF and CSV) for the same account and period.
 *
 * Emits SOURCE_CROSSCHECK_FAILED when divergences are found (PRD V2 §4.3, §5):
 * - Bank identity mismatch
 * - Account mismatch
 * - Period mismatch
 * - Transaction count divergence
 * - Debit/credit total divergence
 * - Balance divergence (when both provide balances)
 */
export function crosscheckSources(
  primary: CanonicalStatementDocument,
  secondary: CanonicalStatementDocument,
): CrosscheckResult {
  const diagnostics: CrosscheckDiagnostic[] = []
  const issues: ImportIssue[] = []

  // Identity checks
  compareField(diagnostics, "institutionCode", primary.institutionCode, secondary.institutionCode)
  compareField(
    diagnostics,
    "account",
    primary.identity.account?.normalized ?? "",
    secondary.identity.account?.normalized ?? "",
  )
  compareField(
    diagnostics,
    "agency",
    primary.identity.agency?.normalized ?? "",
    secondary.identity.agency?.normalized ?? "",
  )

  // Period check
  const primaryPeriod = primary.period ? `${primary.period.start}..${primary.period.end}` : "ABSENT"
  const secondaryPeriod = secondary.period ? `${secondary.period.start}..${secondary.period.end}` : "ABSENT"
  compareField(diagnostics, "period", primaryPeriod, secondaryPeriod)

  // Transaction count
  compareField(
    diagnostics,
    "transactionCount",
    String(primary.transactions.length),
    String(secondary.transactions.length),
  )

  // Totals by direction
  const primaryTotals = computeDirectionTotals(primary)
  const secondaryTotals = computeDirectionTotals(secondary)
  compareDecimalField(diagnostics, "debitTotal", primaryTotals.debit, secondaryTotals.debit)
  compareDecimalField(diagnostics, "creditTotal", primaryTotals.credit, secondaryTotals.credit)

  // Balance checks (only when both provide them)
  if (primary.openingBalance !== undefined && secondary.openingBalance !== undefined) {
    compareDecimalField(diagnostics, "openingBalance", new Decimal(primary.openingBalance), new Decimal(secondary.openingBalance))
  }
  if (primary.closingBalance !== undefined && secondary.closingBalance !== undefined) {
    compareDecimalField(diagnostics, "closingBalance", new Decimal(primary.closingBalance), new Decimal(secondary.closingBalance))
  }

  if (diagnostics.length === 0) {
    return { status: "PASSED", diagnostics }
  }

  for (const diagnostic of diagnostics) {
    issues.push({
      severity: "ERROR",
      code: "SOURCE_CROSSCHECK_FAILED",
      message: `Divergência entre fontes no campo '${diagnostic.field}': PDF='${diagnostic.pdfValue}', CSV='${diagnostic.csvValue}'.`,
      guidance: "Revise ambos os documentos e confirme qual fonte está correta antes de prosseguir.",
    })
  }

  return { status: "FAILED", diagnostics, issues }
}

/**
 * Extracts the format label for diagnostic messages.
 */
export function formatLabel(format: StatementSourceFormat): string {
  return format === "PDF" ? "PDF" : "CSV"
}

function computeDirectionTotals(document: CanonicalStatementDocument): { debit: Decimal; credit: Decimal } {
  let debit = new Decimal(0)
  let credit = new Decimal(0)
  for (const tx of document.transactions) {
    const amount = new Decimal(tx.amount)
    if (tx.direction === "DEBIT") {
      debit = debit.plus(amount)
    } else {
      credit = credit.plus(amount)
    }
  }
  return { debit, credit }
}

function compareField(
  diagnostics: CrosscheckDiagnostic[],
  field: string,
  primaryValue: string,
  secondaryValue: string,
): void {
  if (primaryValue && secondaryValue && primaryValue !== secondaryValue) {
    diagnostics.push({ field, pdfValue: primaryValue, csvValue: secondaryValue })
  }
}

function compareDecimalField(
  diagnostics: CrosscheckDiagnostic[],
  field: string,
  primaryValue: Decimal,
  secondaryValue: Decimal,
): void {
  if (!primaryValue.equals(secondaryValue)) {
    diagnostics.push({
      field,
      pdfValue: primaryValue.toFixed(2),
      csvValue: secondaryValue.toFixed(2),
    })
  }
}
