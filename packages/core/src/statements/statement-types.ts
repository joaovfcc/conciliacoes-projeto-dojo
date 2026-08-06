import { TabularSourceFormat, TabularWarning, ExtractedTabularRow } from "../tabular/tabular-types.js";

export interface StatementLayoutProfile {
  id: string;
  version: number;
  status: "EXPERIMENTAL" | "VALIDATED" | "DEPRECATED";
  bankCode: string;
  productType: "CHECKING" | "INVESTMENT" | "COLLECTION" | "OTHER";
  formats: TabularSourceFormat[];

  detection: {
    sheetNameAliases?: string[];
    requiredHeaderGroups: string[][];
    optionalHeaders?: string[];
    negativeSheetNames?: string[];
    minimumScore: number;
  };

  columns: {
    date: string[];
    description: string[];
    document?: string[];
    amount?: string[];
    debit?: string[];
    credit?: string[];
    balance?: string[];
  };

  rules: {
    headerScanRows: number;
    negativeAmountMeansDebit: boolean;
    inheritDateFromPreviousRow?: boolean;
    repeatedHeaderPolicy?: "IGNORE" | "ERROR";
    ignoreRowPatterns?: string[];
    stopPatterns?: string[];
  };
}

export interface NormalizedBankTransaction {
  date: string;
  description: string;
  document?: string;
  amount: number;
  direction: "DEBIT" | "CREDIT";
  balance?: number;

  evidence: {
    fileName?: string;
    sourceFormat: TabularSourceFormat;
    sheetName: string;
    sheetIndex: number;
    rowNumber: number;
    profileId: string;
    originalValues: Record<string, string>;
  };

  warnings: TabularWarning[];
}

export interface ParsedStatement {
  transactions: NormalizedBankTransaction[];
  warnings: TabularWarning[];
}
