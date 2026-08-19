import { normalizeHeader, parseDate } from "../normalization.js";
import { normalizeText, parseFlexibleMoney } from "../parsers/text-normalization.js";
import { matchesColumnRole, StandardColumnRole } from "../parsers/header-aliases.js";
import { extractBankMetadataFromGrid } from "../parsers/bank-metadata-extractor.js";
import type { ExtractedTabularRow, ExtractedTabularSheet, TabularSourceFormat, TabularWarning } from "../tabular/tabular-types.js";
import type { NormalizedBankTransaction, ParsedStatement, StatementLayoutProfile } from "./statement-types.js";

type ColumnName = "date" | "description" | "descriptionComplement" | "document" | "amount" | "debit" | "credit" | "balance" | "dcIndicator";

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
    ["date", profile.columns.date],
    ["description", profile.columns.description],
    ["descriptionComplement", profile.columns.descriptionComplement],
    ["document", profile.columns.document],
    ["amount", profile.columns.amount],
    ["debit", profile.columns.debit],
    ["credit", profile.columns.credit],
    ["balance", profile.columns.balance],
    ["dcIndicator", profile.columns.dcIndicator],
  ];

  // 1. Pass: Match from profile-specific column definitions
  for (const [role, aliases] of definitions) {
    for (const alias of aliases ?? []) {
      const candidates = row.cells.filter(
        (candidate) => !usedColumns.has(candidate.columnIndex) && aliasMatches(candidate.displayValue, alias),
      );
      const exactCandidates = candidates.filter(
        (candidate) => normalizeHeader(candidate.displayValue) === normalizeHeader(alias),
      );
      const selectable = exactCandidates.length > 0 ? exactCandidates : candidates;
      if (selectable.length !== 1) continue;
      const cell = selectable[0]!;
      mapping.set(role, cell.columnIndex);
      usedColumns.add(cell.columnIndex);
      break;
    }
  }

  // 2. Pass: Fallback to global HEADER_ALIASES for unmapped standard roles
  const standardRoles: StandardColumnRole[] = [
    "date",
    "description",
    "amount",
    "debit",
    "credit",
    "balance",
    "document",
    "descriptionComplement",
    "dcIndicator",
  ];

  for (const role of standardRoles) {
    if (mapping.has(role)) continue;
    for (const cell of row.cells) {
      if (usedColumns.has(cell.columnIndex)) continue;
      const match = matchesColumnRole(cell.displayValue, role);
      if (match.matched) {
        mapping.set(role, cell.columnIndex);
        usedColumns.add(cell.columnIndex);
        break;
      }
    }
  }

  return mapping;
}

function exactStructuralPattern(row: ExtractedTabularRow, patterns: string[] | undefined): boolean {
  const values = row.cells.map((cell) => normalizeHeader(cell.displayValue)).filter(Boolean);
  return patterns?.some((pattern) => values.length === 1 && values[0] === normalizeHeader(pattern)) ?? false;
}

const GLOBAL_NON_TRANSACTION_PATTERNS = [
  "saldo anterior",
  "saldo atual",
  "saldo final",
  "saldo disponivel",
  "saldo disponível",
  "saldo em investimentos",
  "saldo bloqueado",
  "posicao em",
  "posição em",
  "posicao consolidada",
  "posição consolidada",
  "composicao do saldo",
  "composição do saldo",
  "resumo",
  "subtotal",
  "total",
];

function isStructuralNonTransactionRow(description: string, customPatterns?: string[]): boolean {
  const norm = normalizeText(description);
  if (!norm) return true;

  for (const pattern of GLOBAL_NON_TRANSACTION_PATTERNS) {
    const normPattern = normalizeText(pattern);
    if (norm.startsWith(normPattern) || norm === normPattern) return true;
  }

  if (customPatterns) {
    for (const pattern of customPatterns) {
      const normPattern = normalizeText(pattern);
      if (norm.startsWith(normPattern) || norm === normPattern) return true;
    }
  }

  return false;
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
  if (!headerRow) {
    return { transactions, warnings: [{ code: "NO_HEADER", message: "Linha de cabeçalho não encontrada." }] };
  }

  // Extract robust bank metadata from pre-header and header rows
  const preHeaderGrid = sheet.rows.slice(0, headerRowIndex + 1).map((r) => r.cells);
  const detectedMetadata = extractBankMetadataFromGrid(preHeaderGrid);
  const agency = detectedMetadata.agency;
  const account = detectedMetadata.account;

  const columns = mapColumns(headerRow, profile);
  const hasDate = columns.has("date");
  const hasDescription = columns.has("description");
  const hasAmount = columns.has("amount");
  const hasDebitCredit = columns.has("debit") && columns.has("credit");

  if (!hasDate || !hasDescription || (!hasAmount && !hasDebitCredit)) {
    return {
      transactions,
      warnings: [{ code: "COLUMN_MAPPING_INCOMPLETE", message: "Colunas obrigatórias não foram mapeadas sem ambiguidade." }],
    };
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

    const rawDate = cell(row, "date");
    const description = [
      ...new Set([
        cell(row, "description")?.trim(),
        cell(row, "descriptionComplement")?.trim(),
      ].filter((value): value is string => Boolean(value))),
    ].join(" - ");

    const rawAmount = cell(row, "amount");
    const rawDebit = cell(row, "debit");
    const rawCredit = cell(row, "credit");
    const rawBalance = cell(row, "balance");
    const rawDc = cell(row, "dcIndicator")?.trim().toUpperCase();

    const normalizedDescription = normalizeHeader(description);
    const isOpeningBalance = profile.rules.openingBalancePatterns?.some(
      (pattern) => normalizedDescription.startsWith(normalizeHeader(pattern)),
    ) ?? false;
    const isClosingBalance = profile.rules.closingBalancePatterns?.some(
      (pattern) => normalizedDescription.startsWith(normalizeHeader(pattern)),
    ) ?? false;

    // Check if this row is a structural balance/summary row
    if (isOpeningBalance || isClosingBalance || isStructuralNonTransactionRow(description, profile.rules.ignoreRowPatterns)) {
      const balanceToParse = rawBalance?.trim() || rawAmount?.trim();
      if (balanceToParse) {
        try {
          const balance = parseFlexibleMoney(balanceToParse).toNumber();
          if ((isOpeningBalance || normalizeText(description).includes("saldo anterior")) && openingBalance === undefined) {
            openingBalance = balance;
          }
          if (isClosingBalance || normalizeText(description).includes("saldo final") || normalizeText(description).includes("saldo atual")) {
            closingBalance = balance;
          }
        } catch {
          warnings.push({
            code: "INVALID_BALANCE",
            message: "Saldo estrutural não pôde ser interpretado.",
            sheetName: sheet.name,
            rowNumber: row.rowNumber,
          });
        }
      }
      continue;
    }

    if (exactStructuralPattern(row, profile.rules.ignoreRowPatterns)) continue;

    // Handle multiline descriptions
    if (!rawDate && profile.rules.inheritDateFromPreviousRow && lastDate && description && !rawAmount && !rawDebit && !rawCredit) {
      const previous = transactions.at(-1);
      if (previous) previous.description = `${previous.description} ${description}`.trim();
      continue;
    }

    if (!rawDate) continue;

    let date: string;
    try {
      date = parseDate(rawDate);
      lastDate = rawDate;
    } catch {
      warnings.push({
        code: "INVALID_TRANSACTION_DATE",
        message: "Linha ignorada por data inválida.",
        sheetName: sheet.name,
        rowNumber: row.rowNumber,
      });
      continue;
    }

    if (!description) continue;

    let amount: number;
    let direction: "DEBIT" | "CREDIT";

    try {
      if (rawAmount?.trim()) {
        const val = parseFlexibleMoney(rawAmount);
        if (val.isZero()) continue;

        if (rawDc === "D") {
          direction = "DEBIT";
          amount = val.abs().toNumber();
        } else if (rawDc === "C") {
          direction = "CREDIT";
          amount = val.abs().toNumber();
        } else {
          amount = val.abs().toNumber();
          direction = val.isNegative() ? "DEBIT" : "CREDIT";
        }
      } else if (rawDebit?.trim()) {
        amount = parseFlexibleMoney(rawDebit).abs().toNumber();
        direction = "DEBIT";
      } else if (rawCredit?.trim()) {
        amount = parseFlexibleMoney(rawCredit).abs().toNumber();
        direction = "CREDIT";
      } else {
        continue;
      }
    } catch {
      warnings.push({
        code: "INVALID_TRANSACTION_AMOUNT",
        message: "Linha ignorada por valor inválido.",
        sheetName: sheet.name,
        rowNumber: row.rowNumber,
      });
      continue;
    }

    let balance: number | undefined;
    if (rawBalance?.trim()) {
      try {
        balance = parseFlexibleMoney(rawBalance).toNumber();
      } catch {
        warnings.push({
          code: "INVALID_BALANCE",
          message: "Saldo da linha não pôde ser interpretado.",
          sheetName: sheet.name,
          rowNumber: row.rowNumber,
        });
      }
    }

    const originalValues = Object.fromEntries(
      row.cells.map((candidate) => [String(candidate.columnIndex), candidate.displayValue]),
    );

    transactions.push({
      date,
      description,
      ...(cell(row, "document")?.trim() ? { document: cell(row, "document")!.trim() } : {}),
      amount,
      direction,
      ...(balance !== undefined ? { balance } : {}),
      evidence: {
        ...(fileName ? { fileName } : {}),
        sourceFormat,
        sheetName: sheet.name,
        sheetIndex: sheet.index,
        rowNumber: row.rowNumber,
        profileId: profile.id,
        originalValues,
      },
      warnings: [],
    });
  }

  const detectedBank = detectedMetadata.bankCode || detectedMetadata.bank;

  return {
    transactions,
    warnings,
    metadata: {
      ...(detectedBank ? { bank: detectedBank } : {}),
      ...(agency ? { agency } : {}),
      ...(account ? { account } : {}),
      ...(openingBalance !== undefined ? { openingBalance } : {}),
      ...(closingBalance !== undefined ? { closingBalance } : {}),
    },
  };
}
