import { normalizeHeader, parseDate, parseMoney } from "../normalization.js";
import type { ExtractedTabularRow, ExtractedTabularSheet, TabularSourceFormat, TabularWarning } from "../tabular/tabular-types.js";
import type { NormalizedBankTransaction, ParsedStatement, StatementLayoutProfile } from "./statement-types.js";

type ColumnName = "date" | "description" | "descriptionComplement" | "document" | "amount" | "debit" | "credit" | "balance";

function aliasMatches(header: string, alias: string): boolean {
  const normalizedHeader = normalizeHeader(header);
  const normalizedAlias = normalizeHeader(alias);
  if (normalizedHeader === normalizedAlias) return true;
  const headerTokens = new Set(normalizedHeader.split("_").filter(Boolean));
  const aliasTokens = normalizedAlias.split("_").filter(Boolean);
  return aliasTokens.length > 0 && aliasTokens.every((token) => headerTokens.has(token));
}

function mapColumns(row: ExtractedTabularRow, profile: StatementLayoutProfile): Map<ColumnName, number> {
  const mapping = new Map<ColumnName, number>();
  const usedColumns = new Set<number>();
  const definitions: Array<[ColumnName, string[] | undefined]> = [
    ["date", profile.columns.date], ["description", profile.columns.description], ["descriptionComplement", profile.columns.descriptionComplement], ["document", profile.columns.document],
    ["amount", profile.columns.amount], ["debit", profile.columns.debit], ["credit", profile.columns.credit], ["balance", profile.columns.balance],
  ];
  for (const [role, aliases] of definitions) {
    for (const alias of aliases ?? []) {
      const candidates = row.cells.filter((candidate) =>
        !usedColumns.has(candidate.columnIndex) && aliasMatches(candidate.displayValue, alias)
      );
      const exactCandidates = candidates.filter((candidate) => normalizeHeader(candidate.displayValue) === normalizeHeader(alias));
      const selectable = exactCandidates.length > 0 ? exactCandidates : candidates;
      if (selectable.length !== 1) continue;
      const cell = selectable[0]!;
      mapping.set(role, cell.columnIndex);
      usedColumns.add(cell.columnIndex);
      break;
    }
  }
  return mapping;
}

function exactStructuralPattern(row: ExtractedTabularRow, patterns: string[] | undefined): boolean {
  const values = row.cells.map((cell) => normalizeHeader(cell.displayValue)).filter(Boolean);
  return patterns?.some((pattern) => values.length === 1 && values[0] === normalizeHeader(pattern)) ?? false;
}

export function parseStatement(
  sheet: ExtractedTabularSheet,
  profile: StatementLayoutProfile,
  headerRowIndex: number,
  sourceFormat: TabularSourceFormat,
  fileName?: string,
): ParsedStatement {
  const transactions: NormalizedBankTransaction[] = [];
  const warnings: TabularWarning[] = [];
  const headerRow = sheet.rows[headerRowIndex];
  if (!headerRow) return { transactions, warnings: [{ code: "NO_HEADER", message: "Linha de cabeçalho não encontrada." }] };

  let agency: string | undefined;
  let account: string | undefined;
  for (const row of sheet.rows.slice(0, headerRowIndex)) {
    const text = row.cells.map((cell) => cell.displayValue).join(" ");
    const agencyMatch = /ag[êe]ncia:?\s*([0-9A-Z-]+)/i.exec(text);
    const accountMatch = /conta(?: corrente)?:?\s*([0-9A-Z-]+)/i.exec(text);
    if (agencyMatch?.[1] && !agency) agency = agencyMatch[1];
    if (accountMatch?.[1] && !account) account = accountMatch[1];
  }

  const columns = mapColumns(headerRow, profile);
  if (!columns.has("date") || !columns.has("description") || (!columns.has("amount") && !(columns.has("debit") && columns.has("credit")))) {
    return { transactions, warnings: [{ code: "COLUMN_MAPPING_INCOMPLETE", message: "Colunas obrigatórias não foram mapeadas sem ambiguidade." }] };
  }
  const cell = (row: ExtractedTabularRow, name: ColumnName): string | undefined => {
    const index = columns.get(name);
    return index === undefined ? undefined : row.cells.find((candidate) => candidate.columnIndex === index)?.displayValue;
  };
  let lastDate = "";
  let openingBalance: number | undefined;
  let closingBalance: number | undefined;

  for (const row of sheet.rows.slice(headerRowIndex + 1)) {
    if (exactStructuralPattern(row, profile.rules.stopPatterns)) break;
    if (row.cells.every((candidate) => !candidate.displayValue.trim())) continue;

    let rawDate = cell(row, "date");
    const description = [...new Set([
      cell(row, "description")?.trim(),
      cell(row, "descriptionComplement")?.trim(),
    ].filter((value): value is string => Boolean(value)))].join(" - ");
    const rawAmount = cell(row, "amount");
    const rawDebit = cell(row, "debit");
    const rawCredit = cell(row, "credit");
    const rawBalance = cell(row, "balance");
    const normalizedDescription = normalizeHeader(description);
    const isOpeningBalance = profile.rules.openingBalancePatterns?.some(
      (pattern) => normalizedDescription.startsWith(normalizeHeader(pattern)),
    ) ?? false;
    const isClosingBalance = profile.rules.closingBalancePatterns?.some(
      (pattern) => normalizedDescription.startsWith(normalizeHeader(pattern)),
    ) ?? false;
    if (isOpeningBalance || isClosingBalance) {
      if (rawBalance?.trim()) {
        try {
          const balance = parseMoney(rawBalance).toNumber();
          if (isOpeningBalance && openingBalance === undefined) openingBalance = balance;
          if (isClosingBalance) closingBalance = balance;
        } catch {
          warnings.push({ code: "INVALID_BALANCE", message: "Saldo estrutural não pôde ser interpretado.", sheetName: sheet.name, rowNumber: row.rowNumber });
        }
      }
      continue;
    }
    if (exactStructuralPattern(row, profile.rules.ignoreRowPatterns)) continue;
    if (!rawDate && profile.rules.inheritDateFromPreviousRow && lastDate && description && !rawAmount && !rawDebit && !rawCredit) {
      const previous = transactions.at(-1);
      if (previous) previous.description = `${previous.description} ${description}`.trim();
      continue;
    }
    if (!rawDate) continue;

    let date: string;
    try { date = parseDate(rawDate); lastDate = rawDate; }
    catch {
      warnings.push({ code: "INVALID_TRANSACTION_DATE", message: "Linha ignorada por data inválida.", sheetName: sheet.name, rowNumber: row.rowNumber });
      continue;
    }
    if (!description) continue;

    let amount: number;
    let direction: "DEBIT" | "CREDIT";
    try {
      if (rawAmount?.trim()) {
        const value = parseMoney(rawAmount);
        if (value.isZero()) continue;
        amount = value.abs().toNumber();
        direction = value.isNegative() ? "DEBIT" : "CREDIT";
      } else if (rawDebit?.trim()) {
        amount = parseMoney(rawDebit).abs().toNumber(); direction = "DEBIT";
      } else if (rawCredit?.trim()) {
        amount = parseMoney(rawCredit).abs().toNumber(); direction = "CREDIT";
      } else continue;
    } catch {
      warnings.push({ code: "INVALID_TRANSACTION_AMOUNT", message: "Linha ignorada por valor inválido.", sheetName: sheet.name, rowNumber: row.rowNumber });
      continue;
    }

    let balance: number | undefined;
    if (rawBalance?.trim()) {
      try { balance = parseMoney(rawBalance).toNumber(); }
      catch { warnings.push({ code: "INVALID_BALANCE", message: "Saldo da linha não pôde ser interpretado.", sheetName: sheet.name, rowNumber: row.rowNumber }); }
    }
    const originalValues = Object.fromEntries(row.cells.map((candidate) => [String(candidate.columnIndex), candidate.displayValue]));
    transactions.push({
      date, description,
      ...(cell(row, "document")?.trim() ? { document: cell(row, "document")!.trim() } : {}),
      amount, direction, ...(balance !== undefined ? { balance } : {}),
      evidence: {
        ...(fileName ? { fileName } : {}), sourceFormat, sheetName: sheet.name, sheetIndex: sheet.index,
        rowNumber: row.rowNumber, profileId: profile.id, originalValues,
      },
      warnings: [],
    });
  }
  return {
    transactions,
    warnings,
    metadata: {
      ...(agency ? { agency } : {}),
      ...(account ? { account } : {}),
      ...(openingBalance !== undefined ? { openingBalance } : {}),
      ...(closingBalance !== undefined ? { closingBalance } : {}),
    },
  };
}
