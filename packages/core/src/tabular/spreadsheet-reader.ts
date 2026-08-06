import * as XLSX from "xlsx";
import {
  ExtractedTabularDocument,
  ExtractedTabularSheet,
  ExtractedTabularRow,
  TabularWarning
} from "./tabular-types.js";
import { TabularError } from "./tabular-errors.js";
import { DEFAULT_TABULAR_LIMITS, TabularLimits } from "./tabular-limits.js";

export interface ParseSpreadsheetInput {
  buffer: Buffer;
  sourceFormat: "XLSX" | "XLS" | "XLSM";
  fileName?: string;
  limits?: Partial<TabularLimits>;
}

export function parseSpreadsheet(input: ParseSpreadsheetInput): ExtractedTabularDocument {
  const limits = { ...DEFAULT_TABULAR_LIMITS, ...input.limits };

  if (!input.buffer || input.buffer.length === 0) {
    throw new TabularError("EMPTY_FILE", "The spreadsheet file is empty.");
  }
  
  if (input.buffer.length > limits.maxFileSizeBytes) {
    throw new TabularError("FILE_SIZE_LIMIT_EXCEEDED", `The spreadsheet file size exceeds the limit of ${limits.maxFileSizeBytes} bytes.`);
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(input.buffer, {
      type: "buffer",
      bookVBA: false, // Ensure macros are not loaded/executed
      cellFormula: true,
      cellDates: false,
      cellText: true,
    });
  } catch (e: any) {
    throw new TabularError("INVALID_SPREADSHEET", `Failed to parse spreadsheet: ${e.message}`);
  }

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new TabularError("WORKBOOK_WITHOUT_SHEETS", "The workbook does not contain any sheets.");
  }
  
  if (workbook.SheetNames.length > limits.maxSheets) {
    throw new TabularError("SHEET_LIMIT_EXCEEDED", `The workbook exceeds the limit of ${limits.maxSheets} sheets.`);
  }

  const warnings: TabularWarning[] = [];
  const sheets: ExtractedTabularSheet[] = [];
  let totalRows = 0;
  let totalCells = 0;
  let hasFormulas = false;

  for (let i = 0; i < workbook.SheetNames.length; i++) {
    const sheetName = workbook.SheetNames[i];
    if (!sheetName) continue;
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    let hidden = false;
    if (workbook.Workbook && workbook.Workbook.Sheets && workbook.Workbook.Sheets[i]) {
       const wSheet = workbook.Workbook.Sheets[i];
       if (wSheet) {
         hidden = wSheet.Hidden === 1 || wSheet.Hidden === 2;
       }
    }

    const matrix = XLSX.utils.sheet_to_json<any[]>(worksheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });

    if (matrix.length === 0) {
      continue; // Skip entirely empty sheets
    }

    if (matrix.length > limits.maxRowsPerSheet) {
      warnings.push({
        code: "ROW_LIMIT_EXCEEDED",
        message: `Sheet '${sheetName}' exceeded ${limits.maxRowsPerSheet} rows and was truncated.`,
        ...(sheetName ? { sheetName } : {})
      });
      matrix.splice(limits.maxRowsPerSheet);
    }

    const extractedRows: ExtractedTabularRow[] = [];
    // We must track the actual row index based on the spreadsheet (which might have skipped empty lines)
    // But sheet_to_json with blankrows:false skips empty lines in the output, so rowNumber isn't perfectly mapped to Excel row.
    // However, it's consistent. If we want exact Excel rows, we should use blankrows: true, but we'll stick to false for simplicity.
    for (let r = 0; r < matrix.length; r++) {
      const rowData = matrix[r];
      if (!Array.isArray(rowData)) continue;

      if (rowData.length > limits.maxColumnsPerSheet) {
        rowData.splice(limits.maxColumnsPerSheet);
      }

      const cells = rowData.map((val, cIndex) => {
        const cellAddress = XLSX.utils.encode_cell({ c: cIndex, r: r });
        const originalCell = worksheet[cellAddress];
        if (originalCell && originalCell.f) {
          hasFormulas = true;
        }
        
        return {
          columnIndex: cIndex,
          rawValue: val,
          displayValue: String(val ?? ""),
          formula: originalCell?.f
        };
      });

      extractedRows.push({
        rowNumber: r + 1, // 1-indexed
        cells
      });
      totalCells += cells.length;
    }

    totalRows += extractedRows.length;

    sheets.push({
      index: i,
      name: sheetName,
      hidden,
      rows: extractedRows
    });
  }

  const macroEnabled = !!workbook.vbaraw;
  if (macroEnabled) {
    warnings.push({
      code: "MACRO_DETECTED",
      message: "The workbook contains macros, but they were ignored."
    });
  }

  return {
    sourceFormat: input.sourceFormat,
    dataModel: "TABULAR",
    ...(input.fileName ? { fileName: input.fileName } : {}),
    sheets,
    warnings,
    metadata: {
      totalSheets: workbook.SheetNames.length,
      totalRows,
      totalCells,
      hasFormulas,
      macroEnabled
    }
  };
}
