import type { DocumentKind } from "../types.js";

export interface PdfLayoutProfile {
  adapterId: string;
  adapterVersion: string;
  institutionCode: string;
  documentType: DocumentKind;
  layoutFamily: string;

  detection: {
    positiveSignatures: string[];
    negativeSignatures: string[];
  };

  identity: {
    regex: RegExp;
    agencyGroup?: number;
    accountGroup?: number;
  };

  transactions: {
    headerBoundaryRegex?: RegExp;
    ignoredRegex?: RegExp;
    stopRegex?: RegExp;

    pattern: RegExp;
    dateGroup: number;
    historyGroup: number;
    valueGroup: number;
    documentGroup?: number;
    runningBalanceGroup?: number;
    negativeSignGroup?: number;

    valueIncludesSign?: boolean;
    multiLineHistory?: boolean;
    extractDocumentFromHistory?: boolean;
    inferYear?: (allText: string) => string;
    dateTransform?: (date: string) => string;
    
    /** Optional custom sanitizer for lines, useful for fixing OCR spacing issues. */
    lineSanitizer?: (line: string) => string;
  };
}
