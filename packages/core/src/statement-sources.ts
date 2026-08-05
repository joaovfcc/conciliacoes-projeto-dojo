import type { BankIdentity, DocumentKind, ImportIssue } from "./types.js";

export type StatementSourceFormat = "PDF" | "CSV";

export type SourceProcessingMode =
  | "PDF_PRIMARY"
  | "CSV_PRIMARY"
  | "PDF_PRIMARY_CSV_CROSSCHECK"
  | "CSV_PRIMARY_PDF_EVIDENCE";

export type SourceExtractionMethod = "TEXT" | "OCR" | "MIXED" | "CSV";

export type ExtractedPdfPage = {
  page: number;
  text: string;
  method: Extract<SourceExtractionMethod, "TEXT" | "OCR">;
  confidence?: number;
};

export type ExtractedCsvRow = {
  row: number;
  cells: readonly string[];
};

export type ExtractedStatementSource = {
  sourceId: string;
  format: StatementSourceFormat;
  sha256: string;
  pages?: readonly ExtractedPdfPage[];
  rows?: readonly ExtractedCsvRow[];
};

export type SourceProvenance = {
  sourceId: string;
  format: StatementSourceFormat;
  adapterId: string;
  adapterVersion: string;
  rawHash: string;
  extractionMethod: SourceExtractionMethod;
  page?: number;
  row?: number;
  confidence?: number;
};

export type CanonicalBankTransaction = {
  transactionId: string;
  postingDate: string;
  amount: string;
  direction: "DEBIT" | "CREDIT";
  description: string;
  documentNumber?: string;
  externalId?: string;
  runningBalance?: string;
  provenance: SourceProvenance;
};

export type CanonicalStatementDocument = {
  sourceId: string;
  format: StatementSourceFormat;
  institutionCode: string;
  documentType: DocumentKind;
  layoutFamily: string;
  adapterId: string;
  adapterVersion: string;
  identity: BankIdentity;
  period?: { start: string; end: string };
  transactions: readonly CanonicalBankTransaction[];
  openingBalance?: string;
  closingBalance?: string;
  issues: readonly ImportIssue[];
};

export type StatementSourceDetection = {
  matched: boolean;
  score: number;
  evidenceCodes: readonly string[];
};

export type StatementSourceValidation = {
  accepted: boolean;
  issues: readonly ImportIssue[];
};

export type StatementSourceAdapter<TFormat extends StatementSourceFormat = StatementSourceFormat> = {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly format: TFormat;
  readonly institutionCode: string;
  readonly documentType: DocumentKind;
  readonly layoutFamily: string;
  detect(source: ExtractedStatementSource & { format: TFormat }): StatementSourceDetection;
  parse(source: ExtractedStatementSource & { format: TFormat }): CanonicalStatementDocument | Promise<CanonicalStatementDocument>;
  validate(document: CanonicalStatementDocument): StatementSourceValidation;
};

export type SourceSupportIdentity = Pick<
  StatementSourceAdapter,
  "format" | "institutionCode" | "documentType" | "layoutFamily" | "adapterVersion"
>;

export function createSourceProvenance(input: SourceProvenance): SourceProvenance {
  requireNonEmpty(input.sourceId, "sourceId");
  requireNonEmpty(input.adapterId, "adapterId");
  requireNonEmpty(input.adapterVersion, "adapterVersion");
  if (!/^[a-f\d]{64}$/i.test(input.rawHash)) throw new Error("rawHash must be a hexadecimal SHA-256 value.");
  validatePosition(input.page, "page");
  validatePosition(input.row, "row");
  if (input.confidence !== undefined && (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)) {
    throw new Error("confidence must be between 0 and 1.");
  }
  const compatible = input.format === "CSV"
    ? input.extractionMethod === "CSV"
    : input.extractionMethod === "TEXT" || input.extractionMethod === "OCR" || input.extractionMethod === "MIXED";
  if (!compatible) throw new Error(`Extraction method ${input.extractionMethod} is incompatible with ${input.format}.`);
  return { ...input, rawHash: input.rawHash.toLowerCase() };
}

export function sourceSupportKey(identity: SourceSupportIdentity): string {
  const components = [
    identity.format,
    identity.institutionCode,
    identity.documentType,
    identity.layoutFamily,
    identity.adapterVersion,
  ].map((component) => component.trim());
  if (components.some((component) => !component || component.includes(":"))) {
    throw new Error("Support identity components must be non-empty and cannot contain colons.");
  }
  return components.join(":");
}

export function isReconciliationEligibleDocumentType(documentType: DocumentKind): boolean {
  return documentType === "CURRENT_ACCOUNT";
}

function validatePosition(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
    throw new Error(`${field} must be a positive integer.`);
  }
}

function requireNonEmpty(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} is required.`);
}
