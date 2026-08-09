export type ImportStatus =
  | "RECEIVED"
  | "READING"
  | "LAYOUT_DETECTED"
  | "PARSING"
  | "NEEDS_MAPPING"
  | "PARSED_WITH_WARNINGS"
  | "VALIDATED"
  | "REJECTED";

export interface ImportBatchIssue {
  code: string;
  message: string;
  severity: "WARNING" | "ERROR";
  details?: Record<string, unknown>;
}

export interface ImportBatch {
  id: string;
  companyId: string;
  bankAccountId?: string;
  dataSourceId?: string;
  layoutVersionId?: string;
  fileHash: string;
  deduplicationKey: string;
  status: ImportStatus;
  duplicateAuthorizationGranted: boolean;
  warnings: ImportBatchIssue[];
  errors: ImportBatchIssue[];
  createdAt: Date;
  updatedAt: Date;
  validatedAt?: Date;
}

export interface ImportedFile {
  id: string;
  importBatchId: string;
  originalName: string;
  sanitizedName: string;
  extension: string;
  mimeType: string;
  size: number;
  storageKey?: string;
  createdAt: Date;
}
