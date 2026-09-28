import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { normalizeCode, normalizeHeader } from "../normalization.js";
import { extractBankMetadataFromLines } from "./bank-metadata-extractor.js";
import { decodeText, normalizeAscii } from "./utils.js";
import { parseSpreadsheet } from "../tabular/spreadsheet-reader.js";
import type { SourceFileInput, LedgerFileMetadata } from "./types.js";

export const aliases: Record<string, string[]> = {
  COMPANY: ["EMPRESA", "COD_EMPRESA", "EMP", "COMP"],
  BRANCH: ["FILIAL", "COD_FILIAL", "FILIAL_DE_ORIGEM", "FIL"],
  ACCOUNT: ["CONTA_CONTABIL", "CONTA", "CT2_DEBITO", "CT2_CREDIT", "CONTA_REDUZIDA", "COD_CONTA"],
  DATE: ["DATA", "DT_LANCAMENTO", "DATA_LANCAMENTO", "DTPOSTED", "DT_MOVTO", "DT_MOV", "DATA_MOVIMENTO", "DT"],
  DOCUMENT: ["DOCUMENTO", "DOC", "NUM_DOCUMENTO", "CHECKNUM", "REFNUM", "NUMERO_DOC", "DOCTO", "NUM_DOC"],
  HISTORY: ["HISTORICO", "DESCRICAO", "MEMO", "NAME", "COMPLEMENTO", "HISTORICO_LANCAMENTO", "LANCAMENTO"],
  DEBIT: ["DEBITO", "VALOR_DEBITO", "DEB", "VR_DEBITO", "VL_DEBITO"],
  CREDIT: ["CREDITO", "VALOR_CREDITO", "CRED", "VR_CREDITO", "VL_CREDITO"],
  VALUE: ["VALOR", "VALOR_LIQUIDO", "TRNAMT", "VALOR_LANCAMENTO", "VLR_LANCAMENTO", "VALOR_RS", "VLR"],
  SOURCE_ID: ["IDENTIFICADOR", "ID", "ID_PROTHEUS", "LOTE_SUB_DOC_LINHA", "FITID", "ID_BANCARIO", "LOTE"],
  BALANCE: ["SALDO", "SALDO_ATUAL", "SALDO_APOS_LANCAMENTO", "SALDO_ATUAL_RS"],
};

export const aliasLookup = new Map(
  Object.entries(aliases).flatMap(([canonical, names]) => names.map((name) => [name, canonical])),
);

export function extensionOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export async function tabularRows(
  file: SourceFileInput,
): Promise<{ rows: Array<{ position: number; values: Record<string, unknown> }>; metadata: LedgerFileMetadata }> {
  const extension = extensionOf(file.originalName);
  let rawRows: unknown[][];
  let baseLine = 1;
  const metadata: LedgerFileMetadata = { ledgerAccount: "", bank: "", agency: "", bankAccount: "" };

  if (extension === "csv") {
    const text = decodeText(file.buffer);
    const delimiter = [";", ",", "\t", "|"].sort((a, b) => text.split(b).length - text.split(a).length)[0] ?? ";";
    rawRows = parseCsv(text, { delimiter, relax_column_count: true, skip_empty_lines: true }) as unknown[][];
  } else {
    let loaded = false;
    let best: { score: number; rows: unknown[][]; header: number } = { score: -1, rows: [], header: 0 };

    // Try ExcelJS first (preserves native Date objects in XLSX cells)
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
      workbook.eachSheet((sheet) => {
        const rows = sheet.getSheetValues().slice(1).map((row) => (Array.isArray(row) ? row.slice(1) : []));
        for (const [index, row] of rows.slice(0, 100).entries()) {
          const score = row.map(normalizeHeader).filter((header) => aliasLookup.has(header)).length;
          if (score > best.score) best = { score, rows, header: index };
        }
        for (const row of rows.slice(0, 100)) {
          for (const value of row) {
            const str = String(value ?? "").trim();
            if (!str) continue;
            const match = /\bCONTA\s*-\s*([0-9][0-9.]*)\s*-/i.exec(str);
            if (match && !metadata.ledgerAccount) {
              metadata.ledgerAccount = match[1]!.replace(/\D/g, "");
            }
            const bankCandidate = extractBankMetadataFromLines([str]);
            if (bankCandidate.bank && !metadata.bank) metadata.bank = bankCandidate.bank;
            if (bankCandidate.agency && !metadata.agency) metadata.agency = bankCandidate.agency;
            if (bankCandidate.account && !metadata.bankAccount) metadata.bankAccount = bankCandidate.account;
          }
        }
      });
      if (best.rows.length > 0 && best.score > 0) {
        rawRows = best.rows.slice(best.header);
        baseLine = best.header + 1;
        loaded = true;
      }
    } catch {
      // ExcelJS couldn't parse (e.g. XLS legacy, corrupted metadata) -> fall through to SheetJS
    }

    // SheetJS fallback (supports XLS, XLSM and non-standard XLSX)
    if (!loaded) {
      const format = (extension === "xls" ? "XLS" : extension === "xlsm" ? "XLSM" : "XLSX") as "XLSX" | "XLS" | "XLSM";
      const doc = parseSpreadsheet({ buffer: file.buffer, sourceFormat: format, fileName: file.originalName });

      for (const sheet of doc.sheets) {
        const sheetGrid: unknown[][] = sheet.rows.map((row) => row.cells.map((cell) => cell.rawValue ?? cell.displayValue));

        for (const [index, row] of sheetGrid.slice(0, 100).entries()) {
          const score = row.map(normalizeHeader).filter((header) => aliasLookup.has(header)).length;
          if (score > best.score) best = { score, rows: sheetGrid, header: index };
        }

        for (const row of sheetGrid.slice(0, 100)) {
          for (const value of row) {
            const str = String(value ?? "").trim();
            if (!str) continue;
            const match = /\bCONTA\s*-\s*([0-9][0-9.]*)\s*-/i.exec(str);
            if (match && !metadata.ledgerAccount) {
              metadata.ledgerAccount = match[1]!.replace(/\D/g, "");
            }
            const bankCandidate = extractBankMetadataFromLines([str]);
            if (bankCandidate.bank && !metadata.bank) metadata.bank = bankCandidate.bank;
            if (bankCandidate.agency && !metadata.agency) metadata.agency = bankCandidate.agency;
            if (bankCandidate.account && !metadata.bankAccount) metadata.bankAccount = bankCandidate.account;
          }
        }
      }

      rawRows = best.rows.slice(best.header);
      baseLine = best.header + 1;
    }
  }

  if (!rawRows!.length) throw new Error("O arquivo tabular está vazio.");

  const headers = rawRows![0]!.map((value) => aliasLookup.get(normalizeHeader(value)) ?? normalizeHeader(value));

  let currentStickyAccount = metadata.ledgerAccount;
  let currentStickyDate: unknown = undefined;

  const rows: Array<{ position: number; values: Record<string, unknown> }> = [];

  for (let index = 1; index < rawRows!.length; index++) {
    const rawRow = rawRows![index]!;
    const position = baseLine + index;
    const values: Record<string, unknown> = Object.fromEntries(
      headers.map((header, column) => [header, rawRow[column]]),
    );

    // Skip totally empty rows
    if (!Object.values(values).some((v) => v !== null && v !== undefined && String(v).trim() !== "")) {
      continue;
    }

    // Check for inline account block headers
    const joinedRowText = Object.values(values).map((v) => String(v ?? "")).join(" ");
    const accountBlockMatch = /\bCONTA\s*-\s*([0-9][0-9.]*)\s*-/i.exec(joinedRowText);
    if (accountBlockMatch) {
      currentStickyAccount = accountBlockMatch[1]!.replace(/\D/g, "");
      if (!metadata.ledgerAccount) {
        metadata.ledgerAccount = currentStickyAccount;
      }
    }

    // Sticky account propagation
    if (values.ACCOUNT && String(values.ACCOUNT).trim()) {
      currentStickyAccount = normalizeCode(values.ACCOUNT);
    } else if (currentStickyAccount) {
      values.ACCOUNT = currentStickyAccount;
    }

    // Sticky date propagation
    const rawDateVal = values.DATE;
    if (rawDateVal instanceof Date || (typeof rawDateVal === "string" && rawDateVal.trim())) {
      currentStickyDate = rawDateVal;
    } else if (!rawDateVal && currentStickyDate && (values.DEBIT || values.CREDIT || values.VALUE)) {
      values.DATE = currentStickyDate;
    }

    rows.push({ position, values });
  }

  return { rows, metadata };
}

export function isLedgerStructureRow(values: Record<string, unknown>): boolean {
  const date = normalizeAscii(String(values.DATE ?? "")).trim().toUpperCase();
  const rowTokens = Object.values(values)
    .map((v) => normalizeAscii(String(v ?? "")).trim().toUpperCase())
    .filter(Boolean);
  const fullText = rowTokens.join(" ");

  // Repeated header
  if (date === "DATA" || date === "DT" || date === "DT_LANCAMENTO") return true;

  // Account block headers
  if (date === "CONTA" || /^\d+(?:\.\d+)+\.?$/.test(date) || /^CONTA\s*-/.test(fullText)) return true;

  // Structural balance/summary lines
  const structuralPatterns = [
    "SALDO ANTERIOR",
    "SALDO ATUAL",
    "SALDO FINAL",
    "TOTAL DA CONTA",
    "TOTAL GERAL",
    "SUBTOTAL",
    "A TRANSPORTAR",
    "DO TRANSPORTE",
  ];

  if (structuralPatterns.some((pattern) => fullText.includes(pattern))) {
    return true;
  }

  // Regex para rodapés e totalizadores espaçados típicos do Protheus / ERPs legados:
  // "T o t a i s   d a   C o n t a   ==>", "T O T A L   G E R A L   ==>", "S A L D O   A T U A L"
  const spacedPatterns = [
    /\bT\s*O\s*T\s*A\s*I\s*S\s*(?:D\s*A\s*C\s*O\s*N\s*T\s*A)?/i,
    /\bT\s*O\s*T\s*A\s*L\s*G\s*E\s*R\s*A\s*L/i,
    /\bS\s*A\s*L\s*D\s*O\s*A\s*T\s*U\s*A\s*L/i,
    /\bS\s*A\s*L\s*D\s*O\s*A\s*N\s*T\s*E\s*R\s*I\s*O\s*R/i,
    /={2,}>?/,
  ];

  return spacedPatterns.some((pattern) => pattern.test(fullText));
}
