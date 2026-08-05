import type {
  ConfirmProcessingRequest,
  LedgerRecord,
  PreflightResult,
  ProcessingResult,
  InvestmentEntry,
  StatementRecord,
} from "@conciliacao/core";

export const sessionStatuses = [
  "DRAFT", "UPLOADING", "READY", "PREFLIGHT", "AWAITING_CONFIRMATION", "QUEUED",
  "VALIDATING", "EXTRACTING", "OCR_PROCESSING", "RECONCILING", "COMPLETED",
  "COMPLETED_WITH_ISSUES", "FAILED", "CANCELLING", "CANCELLED", "EXPIRED",
] as const;
export type SessionStatus = (typeof sessionStatuses)[number];

export type StoredFile = {
  id: string;
  kind: "LEDGER" | "STATEMENT";
  originalName: string;
  contentType: string;
  size: number;
  objectKey: string;
  sha256?: string;
};

export type ReconciliationSession = {
  id: string;
  tokenHash: string;
  clientKey: string;
  createdAt: string;
  expiresAt: string;
  lastHeartbeatAt: string;
  status: SessionStatus;
  progress: number;
  progressMessage: string;
  pendingAction?: "PREFLIGHT" | "PROCESS";
  files: StoredFile[];
  preflight?: PreflightResult;
  ledgers?: LedgerRecord[];
  statements?: StatementRecord[];
  investments?: InvestmentEntry[];
  confirmation?: ConfirmProcessingRequest;
  result?: ProcessingResult;
  errorCode?: string;
  errorMessage?: string;
  closed: boolean;
};

export type PublicSession = Omit<
  ReconciliationSession,
  "tokenHash" | "clientKey" | "ledgers" | "statements" | "investments" | "confirmation"
>;

export type CreateSessionResult = {
  session: PublicSession;
  token: string;
};
