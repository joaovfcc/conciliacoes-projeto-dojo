export type TabularSourceFormat = "CSV" | "XLSX" | "XLS" | "XLSM";

export interface ExtractedTabularCell {
  columnIndex: number;
  rawValue: unknown;
  displayValue: string;
  formula?: string;
}

export interface ExtractedTabularRow {
  rowNumber: number;
  cells: ExtractedTabularCell[];
}

export interface ExtractedTabularSheet {
  index: number;
  name: string;
  hidden: boolean;
  rows: ExtractedTabularRow[];
}

export interface TabularWarning {
  code: string;
  message: string;
  sheetName?: string;
  rowNumber?: number;
  columnIndex?: number;
}

export interface ExtractedTabularDocument {
  sourceFormat: TabularSourceFormat;
  dataModel: "TABULAR";
  fileName?: string;
  sheets: ExtractedTabularSheet[];
  warnings: TabularWarning[];
  metadata: {
    totalSheets: number;
    totalRows: number;
    totalCells: number;
    hasFormulas: boolean;
    macroEnabled: boolean;
  };
}

/**
 * @deprecated Use ExtractedTabularRow.
 */
export type ExtractedCsvRow = ExtractedTabularRow;
