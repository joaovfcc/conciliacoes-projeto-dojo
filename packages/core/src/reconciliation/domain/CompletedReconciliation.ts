import type { ConfirmProcessingRequest, ProcessingResult } from "../../types.js";

export type CompletedReconciliationStatus = "COMPLETED" | "COMPLETED_WITH_ISSUES";

export type CompletedSourceFile = {
  id: string;
  kind: "LEDGER" | "STATEMENT";
  originalName: string;
  sha256?: string;
};

export type CompletedReconciliation = {
  id: string;
  organizationId: string;
  companyId: string;
  userId: string;
  status: CompletedReconciliationStatus;
  period: string;
  confirmation: ConfirmProcessingRequest;
  sourceFiles: CompletedSourceFile[];
  result: ProcessingResult;
  completedAt: Date;
  expiresAt: Date;
};

export type CompletedReconciliationSummary = Omit<
  CompletedReconciliation,
  "confirmation" | "sourceFiles" | "result"
> & { companyName: string };

export interface CompletedReconciliationRepository {
  save(record: CompletedReconciliation, processingAttemptId?: string, processingGeneration?: number): Promise<boolean>;
  list(companyIds: string[], page: number, size: number, now: Date): Promise<{
    items: CompletedReconciliationSummary[];
    total: number;
  }>;
  findById(id: string, companyIds: string[], now: Date): Promise<CompletedReconciliation | null>;
  delete(id: string, processingAttemptId?: string): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
}
