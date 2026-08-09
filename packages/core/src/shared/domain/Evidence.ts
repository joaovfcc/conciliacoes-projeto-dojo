export interface Evidence {
  id: string;
  importBatchId?: string;
  reconciliationRunId?: string;
  matchGroupId?: string;
  exceptionId?: string;
  type: string;
  source: Record<string, unknown>;
  content?: Record<string, unknown>;
  createdAt: Date;
}

export interface EvidenceRepository {
  save(evidence: Evidence): Promise<void>;
  listByImportBatch(importBatchId: string): Promise<Evidence[]>;
  listByRun(reconciliationRunId: string): Promise<Evidence[]>;
}
