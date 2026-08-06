import { ExtractedTabularSheet } from "../tabular/tabular-types.js";
import { StatementLayoutProfile, ParsedStatement, NormalizedBankTransaction } from "./statement-types.js";
import { parseDate, parseMoney } from "../normalization.js";

export function parseStatement(
  sheet: ExtractedTabularSheet,
  profile: StatementLayoutProfile,
  headerRowIndex: number,
  sourceFormat: any,
  fileName?: string
): ParsedStatement {
  const transactions: NormalizedBankTransaction[] = [];
  const warnings: any[] = [];
  
  if (headerRowIndex < 0 || headerRowIndex >= sheet.rows.length) {
    return { transactions, warnings: [{ code: "NO_HEADER", message: "Header row not found" }] };
  }
  
  const headerRow = sheet.rows[headerRowIndex];
  if (!headerRow) {
    return { transactions, warnings: [{ code: "NO_HEADER", message: "Header row is undefined" }] };
  }
  const colMap = new Map<string, number>();
  
  // Map columns based on profile definitions
  for (const cell of headerRow.cells) {
    const text = cell.displayValue.toLowerCase().trim();
    if (!text) continue;
    
    // Check which profile column this belongs to
    if (profile.columns.date.some(a => text.includes(a.toLowerCase()))) colMap.set("date", cell.columnIndex);
    else if (profile.columns.description.some(a => text.includes(a.toLowerCase()))) colMap.set("description", cell.columnIndex);
    else if (profile.columns.document?.some(a => text.includes(a.toLowerCase()))) colMap.set("document", cell.columnIndex);
    else if (profile.columns.amount?.some(a => text.includes(a.toLowerCase()))) colMap.set("amount", cell.columnIndex);
    else if (profile.columns.debit?.some(a => text.includes(a.toLowerCase()))) colMap.set("debit", cell.columnIndex);
    else if (profile.columns.credit?.some(a => text.includes(a.toLowerCase()))) colMap.set("credit", cell.columnIndex);
    else if (profile.columns.balance?.some(a => text.includes(a.toLowerCase()))) colMap.set("balance", cell.columnIndex);
  }

  let lastDate = "";
  
  for (let r = headerRowIndex + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    if (!row) continue;
    
    // Check stop patterns
    const rowText = row.cells.map(c => c.displayValue).join(" ").toLowerCase();
    if (profile.rules.stopPatterns?.some(p => rowText.includes(p.toLowerCase()))) {
      break;
    }
    
    // Check ignore patterns
    if (profile.rules.ignoreRowPatterns?.some(p => rowText.includes(p.toLowerCase()))) {
      continue;
    }
    
    // Extract values
    const getCell = (colName: string) => {
      const colIdx = colMap.get(colName);
      if (colIdx === undefined) return undefined;
      return row.cells.find(c => c.columnIndex === colIdx)?.displayValue;
    };
    
    let rawDate = getCell("date");
    const rawDesc = getCell("description");
    const rawDoc = getCell("document");
    const rawAmount = getCell("amount");
    const rawDebit = getCell("debit");
    const rawCredit = getCell("credit");
    const rawBalance = getCell("balance");
    
    // Skip empty description rows (common in Excel)
    if (!rawDesc || rawDesc.trim() === "") continue;

    if (!rawDate && profile.rules.inheritDateFromPreviousRow && lastDate) {
      rawDate = lastDate;
    }
    
    if (!rawDate) {
       continue; // Can't process without date
    }
    
    let dateStr = "";
    try {
      dateStr = parseDate(rawDate);
      lastDate = rawDate;
    } catch {
      continue; // Skip invalid dates
    }

    let amount = 0;
    let direction: "DEBIT" | "CREDIT" = "CREDIT";

    try {
      if (colMap.has("amount") && rawAmount) {
        const val = parseMoney(rawAmount).toNumber();
        amount = Math.abs(val);
        if (val < 0 || profile.rules.negativeAmountMeansDebit && val < 0) {
          direction = "DEBIT";
        } else if (val > 0) {
          direction = "CREDIT";
        } else {
          continue; // Zero amount
        }
      } else if (colMap.has("debit") && rawDebit) {
        amount = Math.abs(parseMoney(rawDebit).toNumber());
        direction = "DEBIT";
      } else if (colMap.has("credit") && rawCredit) {
        amount = Math.abs(parseMoney(rawCredit).toNumber());
        direction = "CREDIT";
      } else {
        continue;
      }
    } catch {
      continue;
    }

    let balance: number | undefined;
    if (colMap.has("balance") && rawBalance) {
      try {
        balance = parseMoney(rawBalance).toNumber();
      } catch {
        // ignore
      }
    }
    
    const originalValues: Record<string, string> = {};
    for (const cell of row.cells) {
      originalValues[cell.columnIndex.toString()] = cell.displayValue;
    }

    transactions.push({
      date: dateStr,
      description: rawDesc.trim(),
      ...(rawDoc ? { document: rawDoc.trim() } : {}),
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
        originalValues
      },
      warnings: []
    });
  }

  return { transactions, warnings };
}
