import type {
  CompletedReconciliation,
  CompletedReconciliationRepository,
  CompletedReconciliationSummary,
} from "../domain/CompletedReconciliation.js";

export class InMemoryCompletedReconciliationRepository implements CompletedReconciliationRepository {
  readonly records = new Map<string, CompletedReconciliation>();
  private readonly processingAttempts = new Map<string, { id: string; generation: number }>();

  constructor(
    private readonly maxRecords = Number.parseInt(process.env.MAX_COMPLETED_RECONCILIATIONS ?? "50", 10) || 50,
  ) {}

  async save(record: CompletedReconciliation, processingAttemptId?: string, processingGeneration?: number): Promise<boolean> {
    const created = !this.records.has(record.id);
    if (!processingAttemptId || processingGeneration === undefined) {
      this.records.set(record.id, structuredClone(record));
      this.processingAttempts.delete(record.id);
      if (created) this.evictOldest();
      return created;
    }
    const currentAttempt = this.processingAttempts.get(record.id);
    if (!created && currentAttempt && currentAttempt.generation > processingGeneration) return false;
    this.records.set(record.id, structuredClone(record));
    this.processingAttempts.set(record.id, { id: processingAttemptId, generation: processingGeneration });
    if (created) this.evictOldest();
    return true;
  }

  private evictOldest(): void {
    if (this.maxRecords <= 0 || this.records.size <= this.maxRecords) return;
    const sorted = [...this.records.values()].sort(
      (left, right) => left.completedAt.getTime() - right.completedAt.getTime(),
    );
    const overflow = this.records.size - this.maxRecords;
    for (const oldest of sorted.slice(0, overflow)) {
      this.records.delete(oldest.id);
      this.processingAttempts.delete(oldest.id);
    }
  }

  async list(companyIds: string[], page: number, size: number, now: Date): Promise<{
    items: CompletedReconciliationSummary[];
    total: number;
  }> {
    const authorized = new Set(companyIds);
    const records = [...this.records.values()]
      .filter((record) => authorized.has(record.companyId) && record.expiresAt > now)
      .sort((left, right) => right.completedAt.getTime() - left.completedAt.getTime());
    return {
      items: records.slice((page - 1) * size, page * size).map((record) => ({
        id: record.id,
        organizationId: record.organizationId,
        companyId: record.companyId,
        companyName: record.companyId,
        userId: record.userId,
        status: record.status,
        period: record.period,
        completedAt: record.completedAt,
        expiresAt: record.expiresAt,
      })),
      total: records.length,
    };
  }

  async findById(id: string, companyIds: string[], now: Date): Promise<CompletedReconciliation | null> {
    const record = this.records.get(id);
    return record && companyIds.includes(record.companyId) && record.expiresAt > now
      ? structuredClone(record)
      : null;
  }

  async deleteExpired(now: Date): Promise<number> {
    let deleted = 0;
    for (const [id, record] of this.records) {
      if (record.expiresAt <= now) {
        this.records.delete(id);
        this.processingAttempts.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }

  async delete(id: string, processingAttemptId?: string): Promise<void> {
    if (processingAttemptId && this.processingAttempts.get(id)?.id !== processingAttemptId) return;
    this.records.delete(id);
    this.processingAttempts.delete(id);
  }
}
