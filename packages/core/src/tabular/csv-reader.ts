import { parse } from "csv-parse/sync";
import {
  ExtractedTabularDocument,
  ExtractedTabularRow
} from "./tabular-types.js";
import { TabularError } from "./tabular-errors.js";
import { DEFAULT_TABULAR_LIMITS, TabularLimits } from "./tabular-limits.js";

export interface ParseCsvInput {
  buffer: Buffer;
  fileName?: string;
  limits?: Partial<TabularLimits>;
}

export function parseCsv(input: ParseCsvInput): ExtractedTabularDocument {
  const limits = { ...DEFAULT_TABULAR_LIMITS, ...input.limits };
  
  if (!input.buffer || input.buffer.length === 0) {
    throw new TabularError("EMPTY_FILE", "The CSV file is empty.");
  }
  
  if (input.buffer.length > limits.maxFileSizeBytes) {
    throw new TabularError("FILE_SIZE_LIMIT_EXCEEDED", `The CSV file size exceeds the limit of ${limits.maxFileSizeBytes} bytes.`);
  }

  let str = input.buffer.toString("utf8");
  if (str.charCodeAt(0) === 0xFEFF) {
    str = str.slice(1);
  }

  let records: string[][];
  try {
    records = parse(str, {
      skip_empty_lines: true,
      relax_column_count: true,
      delimiter: [";", ",", "\t"]
    });
  } catch (e: any) {
    throw new TabularError("INVALID_CSV", `Failed to parse CSV: ${e.message}`);
  }

  if (records.length > limits.maxRowsPerSheet) {
    throw new TabularError("ROW_LIMIT_EXCEEDED", `The CSV exceeds the maximum limit of ${limits.maxRowsPerSheet} rows.`);
  }

  const rows: ExtractedTabularRow[] = records.map((record, rowIndex) => {
    return {
      rowNumber: rowIndex + 1,
      cells: record.map((val, colIndex) => ({
        columnIndex: colIndex,
        rawValue: val,
        displayValue: val,
      })),
    };
  });

  return {
    sourceFormat: "CSV",
    dataModel: "TABULAR",
    ...(input.fileName ? { fileName: input.fileName } : {}),
    sheets: [
      {
        index: 0,
        name: "CSV",
        hidden: false,
        rows,
      }
    ],
    warnings: [],
    metadata: {
      totalSheets: 1,
      totalRows: rows.length,
      totalCells: rows.reduce((acc, row) => acc + row.cells.length, 0),
      hasFormulas: false,
      macroEnabled: false
    }
  };
}
