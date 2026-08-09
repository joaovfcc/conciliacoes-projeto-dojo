import { extname } from "node:path";
import { normalizeHeader } from "../../normalization.js";
import { parseStatement } from "../../statements/generic-statement-parser.js";
import { detectLayoutResult, type LayoutDetectionResult } from "../../statements/layout-detector.js";
import type { StatementLayoutProfile } from "../../statements/statement-types.js";
import { parseCsv } from "../../tabular/csv-reader.js";
import { parseSpreadsheet } from "../../tabular/spreadsheet-reader.js";
import type { ExtractedTabularDocument, TabularSourceFormat } from "../../tabular/tabular-types.js";
import type { LayoutRepository } from "../../shared/domain/LayoutRepository.js";
import { createLayoutFingerprint } from "./fingerprint.js";
import type { ColumnRole, LayoutFingerprint } from "../domain/LayoutModels.js";

export interface LayoutInspection {
  fingerprint: LayoutFingerprint;
  sheet: { name: string; index: number };
  detection: LayoutDetectionResult;
  preview: Array<{ rowNumber: number; values: string[] }>;
  suggestedColumns: Partial<Record<ColumnRole, number>>;
  normalizedPreview: Array<{
    date: string;
    description: string;
    document?: string;
    amount: string;
    nature: "DEBIT" | "CREDIT";
    balance?: string;
    rowNumber: number;
  }>;
}

export class InspectLayoutUseCase {
  constructor(private readonly layouts: LayoutRepository) {}

  async execute(originalName: string, buffer: Buffer): Promise<LayoutInspection> {
    const document = readDocument(originalName, buffer);
    const fingerprint = createLayoutFingerprint(document);
    const sheet = document.sheets.find((candidate) => !candidate.hidden && candidate.rows.length > 0);
    if (!sheet) throw new Error("O arquivo não possui uma aba tabular legível");
    const profiles = await this.layouts.findAll();
    const detection = detectLayoutResult(sheet, profiles, document.sourceFormat);
    const candidate = detection.match ?? detection.candidates[0];
    const profile = candidate ? profiles.find((item) => item.id === candidate.profileId) : undefined;
    const headerRowIndex = candidate?.headerRowIndex ?? fingerprint.headerRowIndex;
    const suggestedColumns = profile
      ? suggestColumns(sheet.rows[headerRowIndex]?.cells.map((cell) => cell.displayValue) ?? [], profile)
      : {};
    const parsed = profile
      ? parseStatement(sheet, profile, headerRowIndex, document.sourceFormat, originalName)
      : { transactions: [] };
    return {
      fingerprint,
      sheet: { name: sheet.name, index: sheet.index },
      detection,
      preview: sheet.rows.slice(Math.max(0, headerRowIndex - 3), headerRowIndex + 12).map((row) => ({
        rowNumber: row.rowNumber,
        values: row.cells.map((cell) => cell.displayValue),
      })),
      suggestedColumns,
      normalizedPreview: parsed.transactions.slice(0, 10).map((transaction) => ({
        date: transaction.date,
        description: transaction.description,
        ...(transaction.document ? { document: transaction.document } : {}),
        amount: transaction.amount.toFixed(2),
        nature: transaction.direction,
        ...(transaction.balance !== undefined ? { balance: transaction.balance.toFixed(2) } : {}),
        rowNumber: transaction.evidence.rowNumber,
      })),
    };
  }
}

function readDocument(originalName: string, buffer: Buffer): ExtractedTabularDocument {
  const extension = extname(originalName).toLowerCase();
  if (extension === ".csv") return parseCsv({ buffer, fileName: originalName });
  if ([".xlsx", ".xls", ".xlsm"].includes(extension)) {
    return parseSpreadsheet({
      buffer,
      sourceFormat: extension.slice(1).toUpperCase() as Exclude<TabularSourceFormat, "CSV">,
      fileName: originalName,
    });
  }
  throw new Error("A inspeção assistida aceita CSV, XLSX, XLS ou XLSM");
}

function suggestColumns(headers: string[], profile: StatementLayoutProfile): Partial<Record<ColumnRole, number>> {
  const definitions: Array<[ColumnRole, string[] | undefined]> = [
    ["DATE", profile.columns.date],
    ["DESCRIPTION", profile.columns.description],
    ["DOCUMENT", profile.columns.document],
    ["AMOUNT", profile.columns.amount],
    ["DEBIT", profile.columns.debit],
    ["CREDIT", profile.columns.credit],
    ["BALANCE", profile.columns.balance],
  ];
  const output: Partial<Record<ColumnRole, number>> = {};
  headers.forEach((header, columnIndex) => {
    const normalized = normalizeHeader(header);
    const roles = definitions.filter(([, aliases]) => aliases?.some((alias) => normalizeHeader(alias) === normalized));
    if (roles.length === 1) output[roles[0]![0]] = columnIndex;
  });
  return output;
}
