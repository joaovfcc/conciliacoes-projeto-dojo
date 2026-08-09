import { parseDate, parseMoney, normalizeDocument, money } from "../normalization.js";
import { issue, publicError, statementRecord, statementMetadata, extensionOf } from "./utils.js";
import { parseCsv as parseTabularCsv } from "../tabular/csv-reader.js";
import { parseSpreadsheet } from "../tabular/spreadsheet-reader.js";
import { classifySheet } from "../tabular/sheet-classifier.js";
import { detectLayoutResult } from "../statements/layout-detector.js";
import { parseStatement as parseStatementGeneric } from "../statements/generic-statement-parser.js";
import { ITAU_CHECKING_XLSX_V1 } from "../statements/profiles/itau-checking-xlsx-v1.js";
import { GENERIC_STATEMENT_V1 } from "../statements/profiles/generic-statement-v1.js";
import type { SourceFileInput } from "./types.js";
import type { StatementRecord, DetectedStatement, ImportIssue, InvestmentEntry } from "../types.js";
import type { StatementLayoutProfile } from "../statements/statement-types.js";

// PROFILES constant removed, injected dynamically instead.

export async function parseTabularStatement(file: SourceFileInput, profiles: StatementLayoutProfile[]): Promise<{ records: StatementRecord[]; metadata: DetectedStatement; issues: ImportIssue[]; investments: InvestmentEntry[] }> {
  const extension = extensionOf(file.originalName).toUpperCase();
  const format = extension === "CSV" ? "CSV" : (extension as "XLSX" | "XLS" | "XLSM");

  let doc;
  if (format === "CSV") {
    doc = parseTabularCsv({ buffer: file.buffer, fileName: file.originalName });
  } else {
    doc = parseSpreadsheet({ buffer: file.buffer, sourceFormat: format, fileName: file.originalName });
  }

  const issues: ImportIssue[] = [];
  const records: StatementRecord[] = [];

  for (const sheet of doc.sheets) {
    const classification = classifySheet(sheet);
    if (classification.role !== "TRANSACTIONAL") {
       continue;
    }

    if (profiles.length === 0) {
       issues.push(issue("ERROR", "NO_PROFILES_AVAILABLE", `Nenhum layout de extrato disponível no catálogo`, file.id));
       continue;
    }

    const detection = detectLayoutResult(sheet, profiles, format);
    const layoutMatch = detection.match;
    if (!layoutMatch || detection.requiresReview) {
       const code = detection.warnings.includes("LAYOUT_AMBIGUOUS") ? "LAYOUT_AMBIGUOUS" : "LAYOUT_NOT_DETECTED";
       issues.push(issue("WARNING", code, `Layout não reconhecido com segurança na aba ${sheet.name}`, file.id));
       continue;
    }

    const profile = profiles.find(p => p.id === layoutMatch.profileId)!;
    const parsed = parseStatementGeneric(sheet, profile, layoutMatch.headerRowIndex, format, file.originalName);

    const sheetAgency = parsed.metadata?.agency || "";
    const sheetAccount = parsed.metadata?.account || "";

    for (const tx of parsed.transactions) {
      records.push(statementRecord(file, tx.evidence.rowNumber, {
        date: tx.date,
        document: tx.document || "",
        history: tx.description,
        value: money(tx.direction === "DEBIT" ? -tx.amount : tx.amount),
        ...(tx.balance !== undefined ? { runningBalance: money(tx.balance) } : {}),
        sourceId: "", // Not robust enough yet
        bank: profile.bankCode,
        agency: sheetAgency,
        account: sheetAccount,
        extractionMethod: "TABULAR",
        parser: profile.id
      }));
    }
  }

  if (records.length === 0) {
    issues.push(issue("ERROR", "TABULAR_SEM_MOVIMENTOS", "Nenhum movimento conciliável encontrado no arquivo tabular.", file.id));
  }

  const metadata = statementMetadata(file, records, "TABULAR", records[0]?.evidence?.parser || "GENERIC_TABULAR");
  return { records, metadata, issues, investments: [] };
}
