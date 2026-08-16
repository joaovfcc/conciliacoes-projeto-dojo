import { unique, countPeriods, groupCount, issue, extensionOf, statementRecord, statementMetadata, publicError } from "./parsers/utils.js";
import { parseDate, parseMoney, money, normalizeDocument, normalizeCode } from "./normalization.js";
import { parseLedger } from "./parsers/ledger.js";
import { parseOfx } from "./parsers/ofx.js";
import { parsePdf } from "./parsers/pdf.js";
import { parseTabularStatement } from "./parsers/tabular.js";
import { tabularRows } from "./parsers/tabular-utils.js";
import { ITAU_CHECKING_XLSX_V1 } from "./statements/profiles/itau-checking-xlsx-v1.js";
import { GENERIC_STATEMENT_V1 } from "./statements/profiles/generic-statement-v1.js";

import type { SourceFileInput, OcrProvider, ParsedInputBundle } from "./parsers/types.js";
import type { StatementRecord, DetectedStatement, ImportIssue, InvestmentEntry, PreflightResult } from "./types.js";

export async function parseStatement(
  file: SourceFileInput,
  ocrProvider?: OcrProvider,
  options: { maxPdfPages?: number } = {},
): Promise<{ records: StatementRecord[]; metadata: DetectedStatement; issues: ImportIssue[]; investments: InvestmentEntry[] }> {
  const extension = extensionOf(file.originalName);
  if (extension === "ofx") return parseOfx(file);
  if (extension === "pdf") return parsePdf(file, ocrProvider, options.maxPdfPages);

  if (["csv", "xlsx", "xls", "xlsm"].includes(extension)) {
     return parseTabularStatement(file, [ITAU_CHECKING_XLSX_V1, GENERIC_STATEMENT_V1]);
  }

  const rows = await tabularRows(file);
  const issues: ImportIssue[] = [];
  const records: StatementRecord[] = [];
  for (const row of rows.rows) {
    try {
      const date = parseDate(row.values.DATE);
      const value = parseMoney(row.values.VALUE);
      records.push(statementRecord(file, row.position, {
        date,
        document: normalizeDocument(row.values.DOCUMENT),
        history: String(row.values.HISTORY ?? "").trim(),
        value: money(value),
        sourceId: normalizeCode(row.values.SOURCE_ID),
        bank: "",
        agency: "",
        account: "",
        extractionMethod: "TABULAR",
        parser: "TABULAR_V1",
      }));
    } catch (error) {
      issues.push(issue("ERROR", "LINHA_EXTRATO_INVALIDA", publicError(error), file.id, String(row.position)));
    }
  }
  const metadata = statementMetadata(file, records, "TABULAR", "TABULAR_V1");
  return { records, metadata, issues, investments: [] };
}

export async function preflightFiles(
  ledgerFile: SourceFileInput,
  statementFiles: SourceFileInput[],
  ocrProvider?: OcrProvider,
  options: { maxPdfPages?: number } = {},
): Promise<ParsedInputBundle> {
  const ledgerResult = await parseLedger(ledgerFile);
  const statementResults = await Promise.all(statementFiles.map((file) => parseStatement(file, ocrProvider, options)));
  const statements = statementResults.flatMap((item) => item.records);
  const investments = statementResults.flatMap((item) => item.investments);
  const statementMetadata = statementResults.map((item) => item.metadata);
  const issues = [...ledgerResult.issues, ...statementResults.flatMap((item) => item.issues)];
  const companies = unique(ledgerResult.records.map((item) => item.company).filter(Boolean));
  const branches = unique(ledgerResult.records.map((item) => item.branch).filter(Boolean));
  if (companies.length > 1) issues.push(issue("ERROR", "MULTIPLAS_EMPRESAS", "O razão contém mais de uma empresa; envie um razão por empresa."));
  const periods = countPeriods([
    ...ledgerResult.records.map((item) => item.date),
    ...statements.map((item) => item.date),
  ]);
  const ledgerAccounts = [...groupCount(ledgerResult.records, (item) => `${item.company}|${item.branch}|${item.ledgerAccount}`).entries()].map(([key, recordCount]) => {
    const [company = "", branch = "", account = ""] = key.split("|");
    const metadata = account === ledgerResult.metadata.ledgerAccount ? ledgerResult.metadata : undefined;
    return {
      company, branch, account, bank: metadata?.bank ?? "", agency: metadata?.agency ?? "", bankAccount: metadata?.bankAccount ?? "", recordCount,
      ...(metadata?.openingBalance !== undefined ? { openingBalance: metadata.openingBalance } : {}),
      ...(metadata?.closingBalance !== undefined ? { closingBalance: metadata.closingBalance } : {}),
      ...(metadata?.balanceCheck !== undefined ? { balanceCheck: metadata.balanceCheck } : {}),
      ...(metadata?.balanceMovementEffect !== undefined ? { balanceMovementEffect: metadata.balanceMovementEffect } : {}),
    };
  });
  const preflight: PreflightResult = {
    companies,
    branches,
    detectedPeriods: [...periods.entries()].map(([period, recordCount]) => ({ period, recordCount })).sort((a, b) => a.period.localeCompare(b.period)),
    ledgerAccounts,
    statements: statementMetadata,
    investments,
    issues,
    requiresUserInput:
      companies.length !== 1 ||
      branches.length !== 1 ||
      periods.size !== 1 ||
      issues.some((item) => item.severity === "ERROR"),
  };
  return { preflight, ledgers: ledgerResult.records, statements, investments };
}
