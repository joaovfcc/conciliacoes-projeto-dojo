import { DatabaseSync } from "node:sqlite";
import type {
  CompletedReconciliation,
  CompletedReconciliationRepository,
  CompletedReconciliationStatus,
  CompletedReconciliationSummary,
  CompletedSourceFile,
} from "../domain/CompletedReconciliation.js";
import type { ConfirmProcessingRequest, ProcessingResult } from "../../types.js";

export class SqliteCompletedReconciliationRepository implements CompletedReconciliationRepository {
  private readonly db: DatabaseSync;

  constructor(dbInput: string | DatabaseSync = "dados.db") {
    if (typeof dbInput === "string") {
      this.db = new DatabaseSync(dbInput);
    } else {
      this.db = dbInput;
    }
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS completed_reconciliations (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        company_name TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        period TEXT NOT NULL,
        confirmation_json TEXT NOT NULL,
        source_files_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        processing_attempt_id TEXT,
        processing_generation INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_reconciliation_company_expires 
        ON completed_reconciliations (company_id, expires_at);
    `);
  }

  async save(record: CompletedReconciliation, processingAttemptId?: string, processingGeneration?: number): Promise<boolean> {
    const existing = this.db.prepare("SELECT processing_attempt_id, processing_generation FROM completed_reconciliations WHERE id = ?").get(record.id) as { processing_attempt_id: string | null; processing_generation: number | null } | undefined;

    if (!existing) {
      this.db.prepare(`
        INSERT INTO completed_reconciliations (
          id, organization_id, company_id, company_name, user_id, status, period,
          confirmation_json, source_files_json, result_json, completed_at, expires_at,
          processing_attempt_id, processing_generation
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.organizationId,
        record.companyId,
        record.companyId,
        record.userId,
        record.status,
        record.period,
        JSON.stringify(record.confirmation),
        JSON.stringify(record.sourceFiles),
        JSON.stringify(record.result),
        record.completedAt.toISOString(),
        record.expiresAt.toISOString(),
        processingAttemptId ?? null,
        processingGeneration ?? null,
      );
      return true;
    }

    if (processingGeneration !== undefined && existing.processing_generation !== null && existing.processing_generation >= processingGeneration) {
      return false;
    }

    this.db.prepare(`
      UPDATE completed_reconciliations SET
        organization_id = ?,
        company_id = ?,
        company_name = ?,
        user_id = ?,
        status = ?,
        period = ?,
        confirmation_json = ?,
        source_files_json = ?,
        result_json = ?,
        completed_at = ?,
        expires_at = ?,
        processing_attempt_id = ?,
        processing_generation = ?
      WHERE id = ?
    `).run(
      record.organizationId,
      record.companyId,
      record.companyId,
      record.userId,
      record.status,
      record.period,
      JSON.stringify(record.confirmation),
      JSON.stringify(record.sourceFiles),
      JSON.stringify(record.result),
      record.completedAt.toISOString(),
      record.expiresAt.toISOString(),
      processingAttemptId ?? null,
      processingGeneration ?? null,
      record.id,
    );
    return true;
  }

  async list(companyIds: string[], page: number, size: number, now: Date): Promise<{
    items: CompletedReconciliationSummary[];
    total: number;
  }> {
    if (companyIds.length === 0) return { items: [], total: 0 };
    const placeholders = companyIds.map(() => "?").join(",");
    const nowIso = now.toISOString();

    const totalRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM completed_reconciliations
      WHERE company_id IN (${placeholders}) AND expires_at > ?
    `).get(...companyIds, nowIso) as { count: number };

    const total = totalRow?.count ?? 0;
    const offset = (page - 1) * size;

    const rows = this.db.prepare(`
      SELECT id, organization_id, company_id, company_name, user_id, status, period, completed_at, expires_at
      FROM completed_reconciliations
      WHERE company_id IN (${placeholders}) AND expires_at > ?
      ORDER BY completed_at DESC
      LIMIT ? OFFSET ?
    `).all(...companyIds, nowIso, size, offset) as Array<{
      id: string;
      organization_id: string;
      company_id: string;
      company_name: string;
      user_id: string;
      status: string;
      period: string;
      completed_at: string;
      expires_at: string;
    }>;

    return {
      items: rows.map((r) => ({
        id: r.id,
        organizationId: r.organization_id,
        companyId: r.company_id,
        companyName: r.company_name,
        userId: r.user_id,
        status: r.status as CompletedReconciliationStatus,
        period: r.period,
        completedAt: new Date(r.completed_at),
        expiresAt: new Date(r.expires_at),
      })),
      total,
    };
  }

  async findById(id: string, companyIds: string[], now: Date): Promise<CompletedReconciliation | null> {
    if (companyIds.length === 0) return null;
    const placeholders = companyIds.map(() => "?").join(",");
    const nowIso = now.toISOString();

    const row = this.db.prepare(`
      SELECT * FROM completed_reconciliations
      WHERE id = ? AND company_id IN (${placeholders}) AND expires_at > ?
    `).get(id, ...companyIds, nowIso) as {
      id: string;
      organization_id: string;
      company_id: string;
      company_name: string;
      user_id: string;
      status: string;
      period: string;
      confirmation_json: string;
      source_files_json: string;
      result_json: string;
      completed_at: string;
      expires_at: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      organizationId: row.organization_id,
      companyId: row.company_id,
      userId: row.user_id,
      status: row.status as CompletedReconciliationStatus,
      period: row.period,
      confirmation: JSON.parse(row.confirmation_json) as ConfirmProcessingRequest,
      sourceFiles: JSON.parse(row.source_files_json) as CompletedSourceFile[],
      result: JSON.parse(row.result_json) as ProcessingResult,
      completedAt: new Date(row.completed_at),
      expiresAt: new Date(row.expires_at),
    };
  }

  async deleteExpired(now: Date): Promise<number> {
    const res = this.db.prepare(`
      DELETE FROM completed_reconciliations WHERE expires_at <= ?
    `).run(now.toISOString());
    return Number(res.changes);
  }

  async delete(id: string, processingAttemptId?: string): Promise<void> {
    if (processingAttemptId) {
      this.db.prepare(`
        DELETE FROM completed_reconciliations WHERE id = ? AND processing_attempt_id = ?
      `).run(id, processingAttemptId);
    } else {
      this.db.prepare(`
        DELETE FROM completed_reconciliations WHERE id = ?
      `).run(id);
    }
  }
}
