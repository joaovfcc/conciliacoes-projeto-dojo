import type { Prisma, PrismaClient } from "@prisma/client";
import type { Evidence, EvidenceRepository } from "../domain/Evidence.js";

export class PrismaEvidenceRepository implements EvidenceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(evidence: Evidence): Promise<void> {
    await this.prisma.evidence.create({
      data: {
        id: evidence.id,
        importBatchId: evidence.importBatchId ?? null,
        reconciliationRunId: evidence.reconciliationRunId ?? null,
        matchGroupId: evidence.matchGroupId ?? null,
        exceptionId: evidence.exceptionId ?? null,
        type: evidence.type,
        source: evidence.source as Prisma.InputJsonValue,
        ...(evidence.content !== undefined ? { content: evidence.content as Prisma.InputJsonValue } : {}),
        createdAt: evidence.createdAt,
      },
    });
  }

  async listByImportBatch(importBatchId: string): Promise<Evidence[]> {
    return this.find({ importBatchId });
  }

  async listByRun(reconciliationRunId: string): Promise<Evidence[]> {
    return this.find({ reconciliationRunId });
  }

  private async find(where: Prisma.EvidenceWhereInput): Promise<Evidence[]> {
    const records = await this.prisma.evidence.findMany({ where, orderBy: { createdAt: "asc" } });
    return records.map((record) => ({
      id: record.id,
      ...(record.importBatchId ? { importBatchId: record.importBatchId } : {}),
      ...(record.reconciliationRunId ? { reconciliationRunId: record.reconciliationRunId } : {}),
      ...(record.matchGroupId ? { matchGroupId: record.matchGroupId } : {}),
      ...(record.exceptionId ? { exceptionId: record.exceptionId } : {}),
      type: record.type,
      source: record.source as Record<string, unknown>,
      ...(record.content !== null ? { content: record.content as Record<string, unknown> } : {}),
      createdAt: record.createdAt,
    }));
  }
}
