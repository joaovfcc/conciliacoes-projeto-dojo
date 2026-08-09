import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { normalizeCode, normalizeHeader } from "../normalization.js";
import { decodeText, normalizeAscii } from "./utils.js";
import type { SourceFileInput, LedgerFileMetadata } from "./types.js";

export const aliases: Record<string, string[]> = {
  COMPANY: ["EMPRESA", "COD_EMPRESA"],
  BRANCH: ["FILIAL", "COD_FILIAL", "FILIAL_DE_ORIGEM"],
  ACCOUNT: ["CONTA_CONTABIL", "CONTA", "CT2_DEBITO", "CT2_CREDIT"],
  DATE: ["DATA", "DT_LANCAMENTO", "DATA_LANCAMENTO", "DTPOSTED"],
  DOCUMENT: ["DOCUMENTO", "DOC", "NUM_DOCUMENTO", "CHECKNUM", "REFNUM"],
  HISTORY: ["HISTORICO", "DESCRICAO", "MEMO", "NAME"],
  DEBIT: ["DEBITO", "VALOR_DEBITO"],
  CREDIT: ["CREDITO", "VALOR_CREDITO"],
  VALUE: ["VALOR", "VALOR_LIQUIDO", "TRNAMT"],
  SOURCE_ID: ["IDENTIFICADOR", "ID", "ID_PROTHEUS", "LOTE_SUB_DOC_LINHA", "FITID", "ID_BANCARIO"],
};

export const aliasLookup = new Map(
  Object.entries(aliases).flatMap(([canonical, names]) => names.map((name) => [name, canonical])),
);

export function extensionOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export async function tabularRows(file: SourceFileInput): Promise<{ rows: Array<{ position: number; values: Record<string, unknown> }>; metadata: LedgerFileMetadata }> {
  const extension = extensionOf(file.originalName);
  let rawRows: unknown[][];
  let baseLine = 1;
  const metadata: LedgerFileMetadata = { ledgerAccount: "", bank: "", agency: "", bankAccount: "" };
  if (extension === "csv") {
    const text = decodeText(file.buffer);
    const delimiter = [";", ",", "\t", "|"].sort((a, b) => (text.split(b).length - text.split(a).length))[0] ?? ";";
    rawRows = parseCsv(text, { delimiter, relax_column_count: true, skip_empty_lines: true }) as unknown[][];
  } else {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
    let best: { score: number; rows: unknown[][]; header: number } = { score: -1, rows: [], header: 0 };
    workbook.eachSheet((sheet) => {
      const rows = sheet.getSheetValues().slice(1).map((row) => Array.isArray(row) ? row.slice(1) : []);
      for (const [index, row] of rows.slice(0, 25).entries()) {
        const score = row.map(normalizeHeader).filter((header) => aliasLookup.has(header)).length;
        if (score > best.score) best = { score, rows, header: index };
      }
      for (const row of rows.slice(0, 100)) {
        for (const value of row) {
          const match = /\bCONTA\s*-\s*([0-9][0-9.]*)\s*-/i.exec(String(value ?? ""));
          if (match) {
            metadata.ledgerAccount = match[1]!.replace(/\D/g, "");
            const details = String(value ?? "");
            const bankMatch = /\bBANCO\s+([A-ZÀ-Ú0-9]+).*?\bAG\.?\s*([0-9]+).*?\bC\/?C\s*([0-9-]+)/i.exec(details);
            if (bankMatch) {
              metadata.bank = normalizeCode(bankMatch[1]);
              metadata.agency = normalizeCode(bankMatch[2]);
              metadata.bankAccount = normalizeCode(bankMatch[3]);
            }
          }
        }
      }
    });
    rawRows = best.rows.slice(best.header);
    baseLine = best.header + 1;
  }
  if (!rawRows.length) throw new Error("O arquivo tabular está vazio.");
  const headers = rawRows[0]!.map((value) => aliasLookup.get(normalizeHeader(value)) ?? normalizeHeader(value));
  const rows = rawRows.slice(1).map((row, index) => ({
    position: baseLine + index + 1,
    values: Object.fromEntries(headers.map((header, column) => [header, row[column]])),
  })).filter((row) => Object.values(row.values).some((value) => value !== null && value !== undefined && value !== ""));
  return { rows, metadata };
}

export function isLedgerStructureRow(values: Record<string, unknown>): boolean {
  const date = normalizeAscii(String(values.DATE ?? "")).trim().toUpperCase();
  return date === "DATA" || date === "CONTA" || /^\d+(?:\.\d+)+\.?$/.test(date) || /^CONTA\s*-/.test(date);
}
