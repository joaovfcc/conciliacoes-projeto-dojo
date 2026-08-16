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

function physicalWorksheetRange(worksheet: XLSX.WorkSheet): XLSX.Range | undefined {
  let maximumRow = -1;
  let maximumColumn = -1;

  for (const address of Object.keys(worksheet)) {
    if (!/^[A-Z]{1,3}[1-9]\d*$/i.test(address)) continue;
    const cell = XLSX.utils.decode_cell(address);
    maximumRow = Math.max(maximumRow, cell.r);
    maximumColumn = Math.max(maximumColumn, cell.c);
  }

  if (maximumRow < 0 || maximumColumn < 0) return undefined;
  return { s: { r: 0, c: 0 }, e: { r: maximumRow, c: maximumColumn } };
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
  let materializedCells = 0;
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

    const physicalRange = physicalWorksheetRange(worksheet);
    if (!physicalRange) continue;

    const physicalReference = XLSX.utils.encode_range(physicalRange);
    if (worksheet["!ref"] !== physicalReference) {
      warnings.push({
        code: "WORKSHEET_RANGE_REPAIRED",
        message: `Sheet '${sheetName}' declared range '${worksheet["!ref"] ?? "none"}' but contains cells through '${physicalReference}'.`,
        sheetName,
      });
    }

    const effectiveRange: XLSX.Range = {
      s: physicalRange.s,
      e: {
        r: Math.min(physicalRange.e.r, limits.maxRowsPerSheet - 1),
        c: Math.min(physicalRange.e.c, limits.maxColumnsPerSheet - 1),
      },
    };
    if (physicalRange.e.r >= limits.maxRowsPerSheet) {
      warnings.push({
        code: "ROW_LIMIT_EXCEEDED",
        message: `Sheet '${sheetName}' exceeded ${limits.maxRowsPerSheet} rows and was truncated.`,
        sheetName,
      });
    }
    if (physicalRange.e.c >= limits.maxColumnsPerSheet) {
      warnings.push({
        code: "COLUMN_LIMIT_EXCEEDED",
        message: `Sheet '${sheetName}' exceeded ${limits.maxColumnsPerSheet} columns and was truncated.`,
        sheetName,
      });
    }

    const rangeCells = (effectiveRange.e.r + 1) * (effectiveRange.e.c + 1);
    materializedCells += rangeCells;
    if (materializedCells > limits.maxCells) {
      throw new TabularError("CELL_LIMIT_EXCEEDED", `The workbook exceeds the limit of ${limits.maxCells} materialized cells.`);
    }

    const matrix = XLSX.utils.sheet_to_json<any[]>(worksheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
      range: XLSX.utils.encode_range(effectiveRange),
    });

    if (matrix.length === 0) {
      continue; // Skip entirely empty sheets
    }

    const extractedRows: ExtractedTabularRow[] = [];
    for (let r = 0; r < matrix.length; r++) {
      const rowData = matrix[r];
      if (!Array.isArray(rowData)) continue;
      if (rowData.every((value) => String(value ?? "").trim() === "")) continue;

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
        rowNumber: effectiveRange.s.r + r + 1,
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
