import { normalizeText, parseFlexibleMoney } from "./text-normalization.js";
import { matchesColumnRole, StandardColumnRole } from "./header-aliases.js";
import { extractBankMetadataFromGrid, BankMetadataCandidate } from "./bank-metadata-extractor.js";
import { parseDate } from "../normalization.js";
import type { ExtractedTabularRow, ExtractedTabularSheet, TabularSourceFormat } from "../tabular/tabular-types.js";

export interface DiscoveredLayoutColumns {
  date?: number;
  description?: number;
  descriptionComplement?: number;
  document?: number;
  amount?: number;
  debit?: number;
  credit?: number;
  balance?: number;
  dcIndicator?: number;
}

export interface DiscoveredLayout {
  sheetName: string;
  sheetIndex: number;
  headerRowIndex: number;
  columns: DiscoveredLayoutColumns;
  metadata: {
    bank?: string;
    bankCode?: string;
    agency?: string;
    account?: string;
  };
  confidence: number;
  evidence: string[];
  requiresReview: boolean;
  warnings: string[];
}

export interface LayoutDiscoveryResult {
  bestLayout: DiscoveredLayout | null;
  allCandidateLayouts: DiscoveredLayout[];
  warnings: string[];
}

/**
 * Calculates a content quality score by checking valid dates, monetary numbers, and text descriptions below the candidate header
 */
function sampleContentQuality(rows: ExtractedTabularRow[], headerIndex: number, columns: DiscoveredLayoutColumns): {
  validDateRows: number;
  validAmountRows: number;
  sampleSize: number;
  warnings: string[];
} {
  const sample = rows.slice(headerIndex + 1, headerIndex + 31).filter((r) => r.cells.some((c) => c.displayValue.trim()));
  const warnings: string[] = [];
  if (sample.length === 0) {
    return { validDateRows: 0, validAmountRows: 0, sampleSize: 0, warnings: ["NO_CONTENT_ROWS"] };
  }

  let validDateRows = 0;
  let validAmountRows = 0;

  for (const row of sample) {
    // Check date column
    if (columns.date !== undefined) {
      const cell = row.cells.find((c) => c.columnIndex === columns.date);
      if (cell?.displayValue) {
        try {
          parseDate(cell.rawValue || cell.displayValue);
          validDateRows++;
        } catch {}
      }
    }

    // Check amount or debit/credit column
    let hasAmount = false;
    if (columns.amount !== undefined) {
      const cell = row.cells.find((c) => c.columnIndex === columns.amount);
      if (cell?.displayValue) {
        try {
          const val = parseFlexibleMoney(cell.rawValue || cell.displayValue);
          if (!val.isZero()) hasAmount = true;
        } catch {}
      }
    }
    if (!hasAmount && (columns.debit !== undefined || columns.credit !== undefined)) {
      const debCell = columns.debit !== undefined ? row.cells.find((c) => c.columnIndex === columns.debit) : undefined;
      const credCell = columns.credit !== undefined ? row.cells.find((c) => c.columnIndex === columns.credit) : undefined;
      try {
        if (debCell?.displayValue && !parseFlexibleMoney(debCell.displayValue).isZero()) hasAmount = true;
      } catch {}
      try {
        if (credCell?.displayValue && !parseFlexibleMoney(credCell.displayValue).isZero()) hasAmount = true;
      } catch {}
    }
    if (hasAmount) validAmountRows++;
  }

  const dateRatio = validDateRows / sample.length;
  const amountRatio = validAmountRows / sample.length;

  if (dateRatio < 0.2) warnings.push("LOW_VALID_DATE_RATIO");
  if (amountRatio < 0.2) warnings.push("LOW_MONETARY_RATIO");

  return { validDateRows, validAmountRows, sampleSize: sample.length, warnings };
}

/**
 * Discovers layout on a single tabular sheet
 */
export function discoverSheetLayout(sheet: ExtractedTabularSheet, maxHeaderScan = 50): DiscoveredLayout | null {
  if (sheet.rows.length === 0) return null;

  const normalizedSheetName = normalizeText(sheet.name);
  let sheetScoreBonus = 0;
  const sheetEvidence: string[] = [];

  // Sheet name scoring
  if (
    normalizedSheetName.includes("extrato") ||
    normalizedSheetName.includes("lancamento") ||
    normalizedSheetName.includes("movimentacao") ||
    normalizedSheetName.includes("conta corrente")
  ) {
    sheetScoreBonus += 15;
    sheetEvidence.push(`Aba "${sheet.name}" possui nome indicativo de extrato`);
  } else if (
    normalizedSheetName.includes("futuro") ||
    normalizedSheetName.includes("resumo") ||
    normalizedSheetName.includes("posicao") ||
    normalizedSheetName.includes("capa") ||
    normalizedSheetName.includes("instrucao")
  ) {
    sheetScoreBonus -= 30;
    sheetEvidence.push(`Aba "${sheet.name}" possui nome indicativo de não-transacional`);
  }

  let bestLayout: DiscoveredLayout | null = null;
  const scanLimit = Math.min(sheet.rows.length, maxHeaderScan);

  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex++) {
    const row = sheet.rows[rowIndex];
    if (!row || row.cells.every((c) => !c.displayValue.trim())) continue;

    const columns: DiscoveredLayoutColumns = {};
    const usedColumns = new Set<number>();
    const matchedRoles: StandardColumnRole[] = [];
    const rowEvidence: string[] = [...sheetEvidence];
    let headerScore = 0;

    const roleOrder: StandardColumnRole[] = [
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

    for (const role of roleOrder) {
      for (const cell of row.cells) {
        if (usedColumns.has(cell.columnIndex)) continue;
        const match = matchesColumnRole(cell.displayValue, role);
        if (match.matched) {
          columns[role] = cell.columnIndex;
          usedColumns.add(cell.columnIndex);
          matchedRoles.push(role);

          if (match.exact) headerScore += 5;
          rowEvidence.push(`Coluna "${role}" mapeada na coluna ${cell.columnIndex} ("${cell.displayValue}")`);
          break;
        }
      }
    }

    // Minimum required: must have date AND description AND (amount OR (debit AND credit))
    const hasDate = columns.date !== undefined;
    const hasDescription = columns.description !== undefined;
    const hasValue = columns.amount !== undefined || (columns.debit !== undefined && columns.credit !== undefined);

    if (!hasDate || !hasDescription || !hasValue) {
      continue;
    }

    // Score components
    if (hasDate) headerScore += 30;
    if (hasDescription) headerScore += 30;
    if (hasValue) headerScore += 25;
    if (columns.balance !== undefined) headerScore += 15;
    if (columns.document !== undefined) headerScore += 10;

    // Content sampling
    const content = sampleContentQuality(sheet.rows, rowIndex, columns);
    if (content.sampleSize > 0 && content.validDateRows === 0) {
      headerScore -= 50;
      rowEvidence.push("Nenhuma linha de amostra continha data válida");
    } else if (content.validDateRows > 0) {
      headerScore += Math.min(20, Math.round((content.validDateRows / content.sampleSize) * 20));
    }

    // Pre-header metadata extraction
    const preHeaderGrid = sheet.rows.slice(0, rowIndex + 1).map((r) => r.cells);
    const metadataCandidate = extractBankMetadataFromGrid(preHeaderGrid);
    if (metadataCandidate.bank || metadataCandidate.account || metadataCandidate.agency) {
      headerScore += 20;
      rowEvidence.push(...metadataCandidate.evidence);
    }

    const totalScore = Math.max(0, headerScore + sheetScoreBonus);
    const warnings = [...content.warnings];
    const requiresReview = totalScore < 70 || warnings.length > 0;

    const candidate: DiscoveredLayout = {
      sheetName: sheet.name,
      sheetIndex: sheet.index,
      headerRowIndex: rowIndex,
      columns,
      metadata: {
        ...(metadataCandidate.bank ? { bank: metadataCandidate.bank } : {}),
        ...(metadataCandidate.bankCode ? { bankCode: metadataCandidate.bankCode } : {}),
        ...(metadataCandidate.agency ? { agency: metadataCandidate.agency } : {}),
        ...(metadataCandidate.account ? { account: metadataCandidate.account } : {}),
      },
      confidence: totalScore,
      evidence: rowEvidence,
      requiresReview,
      warnings,
    };

    if (!bestLayout || candidate.confidence > bestLayout.confidence) {
      bestLayout = candidate;
    }
  }

  return bestLayout;
}

/**
 * Layout Discovery Engine:
 * Analyzes all sheets in an extracted tabular document and identifies the best layout
 */
export class LayoutDiscoveryEngine {
  static discover(sheets: ExtractedTabularSheet[]): LayoutDiscoveryResult {
    const candidates: DiscoveredLayout[] = [];
    const warnings: string[] = [];

    for (const sheet of sheets) {
      const layout = discoverSheetLayout(sheet);
      if (layout) {
        candidates.push(layout);
      }
    }

    // Sort candidates descending by confidence
    candidates.sort((a, b) => b.confidence - a.confidence);

    const best = candidates[0] ?? null;
    if (!best) {
      warnings.push("LAYOUT_NOT_DISCOVERED");
    }

    return {
      bestLayout: best,
      allCandidateLayouts: candidates,
      warnings,
    };
  }
}
