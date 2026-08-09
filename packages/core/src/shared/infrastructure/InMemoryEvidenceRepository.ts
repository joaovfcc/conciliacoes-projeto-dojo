import type { Evidence, EvidenceRepository } from "../domain/Evidence.js";

export class InMemoryEvidenceRepository implements EvidenceRepository {
  readonly evidences: Evidence[] = [];

  async save(evidence: Evidence): Promise<void> {
    this.evidences.push(structuredClone(evidence));
  }

  async listByImportBatch(importBatchId: string): Promise<Evidence[]> {
    return this.evidences.filter((evidence) => evidence.importBatchId === importBatchId).map((evidence) => structuredClone(evidence));
  }

  async listByRun(reconciliationRunId: string): Promise<Evidence[]> {
    return this.evidences.filter((evidence) => evidence.reconciliationRunId === reconciliationRunId).map((evidence) => structuredClone(evidence));
  }
}
