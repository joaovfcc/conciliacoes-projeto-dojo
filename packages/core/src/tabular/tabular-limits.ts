export interface TabularLimits {
  maxFileSizeBytes: number;
  maxSheets: number;
  maxRowsPerSheet: number;
  maxColumnsPerSheet: number;
  maxCells: number;
  maxCsvRecordSize: number;
  headerScanRows: number;
}

export const DEFAULT_TABULAR_LIMITS: TabularLimits = {
  maxFileSizeBytes: 25 * 1024 * 1024,
  maxSheets: 20,
  maxRowsPerSheet: 100_000,
  maxColumnsPerSheet: 100,
  maxCells: 2_000_000,
  maxCsvRecordSize: 1_000_000,
  headerScanRows: 50,
};
