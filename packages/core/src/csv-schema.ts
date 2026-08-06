import { ExtractedCsvRow } from "./statement-sources.js";
import { parseMoney } from "./normalization.js";

// A simple ASCII normalizer since we don't have it globally exported
function normalizeStr(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

export type CsvColumnSchema = {
  name: string;
  aliases: string[];
  required: boolean;
};

export type CsvSchema = {
  columns: CsvColumnSchema[];
};

export type ParsedCsvRow = {
  row: number;
  fields: Record<string, string>;
  original: ExtractedCsvRow;
};

export function parseCsvSchema(rows: ExtractedCsvRow[], schema: CsvSchema): { headerRow: number; parsed: ParsedCsvRow[] } {
  // Encontrar o cabeçalho
  let headerRow = -1;
  let headerMap = new Map<string, number>();

  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const row = rows[i]!;
    const map = new Map<string, number>();
    const matchedRequired = new Set<string>();

    for (let j = 0; j < row.cells.length; j++) {
      const cell = normalizeStr(row.cells[j]!.toLowerCase());
      for (const col of schema.columns) {
        if (col.aliases.some((alias) => cell === normalizeStr(alias.toLowerCase()))) {
          map.set(col.name, j);
          if (col.required) {
            matchedRequired.add(col.name);
          }
          break;
        }
      }
    }

    const requiredCols = schema.columns.filter((c) => c.required).map((c) => c.name);
    if (requiredCols.length > 0 && requiredCols.every((r) => matchedRequired.has(r))) {
      headerRow = i;
      headerMap = map;
      break;
    }
  }

  if (headerRow === -1) {
    throw new Error("Não foi possível encontrar um cabeçalho compatível com o schema esperado.");
  }

  const parsed: ParsedCsvRow[] = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]!;

    // Ignorar linhas vazias
    if (row.cells.every((c) => !c.trim())) continue;

    // Ignorar repetição de cabeçalho
    if (row.cells.some(c => c === rows[headerRow]!.cells[0])) continue;

    const fields: Record<string, string> = {};
    for (const [name, index] of headerMap.entries()) {
      fields[name] = sanitizeCsvField(row.cells[index] || "");
    }
    parsed.push({
      row: row.row,
      fields,
      original: row,
    });
  }

  return { headerRow, parsed };
}

export function sanitizeCsvField(value: string): string {
  let val = value.trim();
  if (val.startsWith("=") || val.startsWith("+") || val.startsWith("-") || val.startsWith("@")) {
    if (/^[-+]\d/.test(val)) {
      // It's a number, don't strip
    } else {
      // Formula injection mitigation
      val = "'" + val.substring(1);
    }
  }
  return val;
}

export function parseCsvDate(value: string): string | undefined {
  const dateMatch = value.match(/^(\d{2})[/-](\d{2})[/-](\d{2}|\d{4})$/);
  if (dateMatch) {
    let year = dateMatch[3]!;
    if (year.length === 2) year = `20${year}`;
    return `${year}-${dateMatch[2]}-${dateMatch[1]}`;
  }

  // Format YYYY-MM-DD
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return value;
  }

  return undefined;
}

export function parseCsvAmount(value: string): string {
  return parseMoney(value).toFixed(2);
}

export function parseCsvAmountWithSign(value: string, signOrTypeColumn?: string): string {
  const amount = parseCsvAmount(value);
  if (!signOrTypeColumn) return amount;

  const indicator = signOrTypeColumn.trim().toUpperCase();
  if (indicator === "D" || indicator === "-" || indicator === "DEBITO") {
    return amount.startsWith("-") ? amount : `-${amount}`;
  }
  return amount;
}
