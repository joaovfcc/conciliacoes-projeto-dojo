import { createHash } from "node:crypto";
import { normalizeHeader, parseDate, parseMoney } from "../../normalization.js";
import type { ExtractedTabularDocument, ExtractedTabularRow } from "../../tabular/tabular-types.js";
import type { LayoutFingerprint } from "../domain/LayoutModels.js";

function normalizedCells(row: ExtractedTabularRow): string[] {
  return row.cells.map((cell) => normalizeHeader(cell.displayValue)).filter(Boolean);
}

function inferType(values: unknown[]): string {
  const populated = values.filter((value) => String(value ?? "").trim() !== "");
  if (populated.length === 0) return "EMPTY";
  const dateCount = populated.filter((value) => { try { parseDate(value); return true; } catch { return false; } }).length;
  const moneyCount = populated.filter((value) => { try { parseMoney(value); return true; } catch { return false; } }).length;
  if (dateCount / populated.length >= 0.6) return "DATE";
  if (moneyCount / populated.length >= 0.6) return "MONEY";
  return "TEXT";
}

export function createLayoutFingerprint(document: ExtractedTabularDocument): LayoutFingerprint {
  const sheet = document.sheets.find((candidate) => !candidate.hidden && candidate.rows.length > 0);
  if (!sheet) throw new Error("O arquivo não possui uma aba tabular legível.");
  let headerRowIndex = 0;
  let headers: string[] = [];
  for (let index = 0; index < Math.min(sheet.rows.length, 100); index += 1) {
    const cells = normalizedCells(sheet.rows[index]!);
    if (cells.length > headers.length) { headerRowIndex = index; headers = cells; }
    if (cells.length >= 3 && cells.some((cell) => /(^|_)DATA($|_)/.test(cell))) break;
  }
  const headerRow = sheet.rows[headerRowIndex]!;
  const columnCount = Math.max(0, ...headerRow.cells.map((cell) => cell.columnIndex + 1));
  const sampleRows = sheet.rows.slice(headerRowIndex + 1, headerRowIndex + 21);
  const detectedColumnTypes = Array.from({ length: columnCount }, (_, columnIndex) =>
    inferType(sampleRows.map((row) => row.cells.find((cell) => cell.columnIndex === columnIndex)?.rawValue)),
  );
  const preamble = sheet.rows.slice(0, headerRowIndex).flatMap(normalizedCells).join("_");
  const bankHints = [["341", "ITAU"], ["237", "BRADESCO"], ["033", "SANTANDER"], ["070", "BRB"], ["SOFISA", "SOFISA"]]
    .filter(([token]) => new RegExp(`(^|_)${token}($|_)`).test(preamble)).map(([, bank]) => bank!);
  const structural = {
    format: document.sourceFormat,
    normalizedHeaders: headers,
    columnCount,
    headerRowIndex,
    detectedColumnTypes,
    bankHints,
    sheetHints: document.sheets.filter((candidate) => !candidate.hidden).map((candidate) => normalizeHeader(candidate.name)),
  };
  return { ...structural, fingerprintHash: createHash("sha256").update(JSON.stringify(structural)).digest("hex") };
}
