import type {
  BalanceCheck,
  BalanceMovementEffect,
  PreflightResult,
  LedgerRecord,
  StatementRecord,
  InvestmentEntry,
} from "../types.js";

export type SourceFileInput = {
  id: string;
  originalName: string;
  kind: "LEDGER" | "STATEMENT";
  contentType: string;
  buffer: Buffer;
};

export type OcrPage = { page: number; text: string; confidence: string };
export type OcrProvider = (file: SourceFileInput, pages: number[]) => Promise<OcrPage[]>;

export type ParsedInputBundle = {
  preflight: PreflightResult;
  ledgers: LedgerRecord[];
  statements: StatementRecord[];
  investments: InvestmentEntry[];
};

export class StatementParseError extends Error {
  constructor(readonly code: "PDF_LAYOUT_UNSUPPORTED" | "DOCUMENT_CLASSIFICATION_AMBIGUOUS" | "PDF_PASSWORD_PROTECTED" | "PDF_OCR_UNAVAILABLE" | "PDF_INVALID", message: string) {
    super(message);
  }
}

export type LedgerFileMetadata = {
  ledgerAccount: string;
  bank: string;
  agency: string;
  bankAccount: string;
  openingBalance?: string;
  closingBalance?: string;
  balanceCheck?: BalanceCheck;
  balanceMovementEffect?: BalanceMovementEffect;
};
