import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CompletedReconciliation,
  CompletedReconciliationRepository,
  CompletedReconciliationStatus,
  CompletedReconciliationSummary,
  CompletedSourceFile,
} from "../domain/CompletedReconciliation.js";
import type { ConfirmProcessingRequest, ProcessingResult } from "../../types.js";

export class PrismaCompletedReconciliationRepository implements CompletedReconciliationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(record: CompletedReconciliation, processingAttemptId?: string, processingGeneration?: number): Promise<boolean> {
    if (!processingAttemptId || processingGeneration === undefined) {
      return (await this.prisma.completedReconciliation.createMany({
        skipDuplicates: true,
        data: toPersistence(record, null, null),
      })).count === 1;
    }
    const [created, adopted] = await this.prisma.$transaction([
      this.prisma.completedReconciliation.createMany({
        skipDuplicates: true,
        data: toPersistence(record, processingAttemptId, processingGeneration),
      }),
      this.prisma.completedReconciliation.updateMany({
        where: {
          id: record.id,
          OR: [
            { processingAttemptId: null },
            { processingGeneration: { lt: processingGeneration } },
            { processingAttemptId, processingGeneration },
          ],
        },
        data: { processingAttemptId, processingGeneration },
      }),
    ]);
    return created.count === 1 || adopted.count === 1;
  }

  async list(companyIds: string[], page: number, size: number, now: Date): Promise<{
    items: CompletedReconciliationSummary[];
    total: number;
  }> {
    if (companyIds.length === 0) return { items: [], total: 0 };
    const where = { companyId: { in: companyIds }, expiresAt: { gt: now } };
    const [records, total] = await this.prisma.$transaction([
      this.prisma.completedReconciliation.findMany({
        where,
        include: { company: { select: { name: true } } },
        orderBy: { completedAt: "desc" },
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.completedReconciliation.count({ where }),
    ]);
    return {
      items: records.map((record) => ({
        id: record.id,
        organizationId: record.organizationId,
        companyId: record.companyId,
        companyName: record.company.name,
        userId: record.userId,
        status: record.status as CompletedReconciliationStatus,
        period: record.period,
        completedAt: record.completedAt,
        expiresAt: record.expiresAt,
      })),
      total,
    };
  }

  async findById(id: string, companyIds: string[], now: Date): Promise<CompletedReconciliation | null> {
    if (companyIds.length === 0) return null;
    const record = await this.prisma.completedReconciliation.findFirst({
      where: { id, companyId: { in: companyIds }, expiresAt: { gt: now } },
    });
    if (!record) return null;
    return {
      id: record.id,
      organizationId: record.organizationId,
      companyId: record.companyId,
      userId: record.userId,
      status: record.status as CompletedReconciliationStatus,
      period: record.period,
      confirmation: record.confirmation as unknown as ConfirmProcessingRequest,
      sourceFiles: record.sourceFiles as unknown as CompletedSourceFile[],
      result: record.result as unknown as ProcessingResult,
      completedAt: record.completedAt,
      expiresAt: record.expiresAt,
    };
  }

  async deleteExpired(now: Date): Promise<number> {
    return (await this.prisma.completedReconciliation.deleteMany({ where: { expiresAt: { lte: now } } })).count;
  }

  async delete(id: string, processingAttemptId?: string): Promise<void> {
    await this.prisma.completedReconciliation.deleteMany({
      where: { id, ...(processingAttemptId ? { processingAttemptId } : {}) },
    });
  }
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toPersistence(record: CompletedReconciliation, processingAttemptId: string | null, processingGeneration: number | null) {
  return {
    id: record.id,
    organizationId: record.organizationId,
    companyId: record.companyId,
    userId: record.userId,
    status: record.status,
    period: record.period,
    confirmation: toJson(record.confirmation),
    sourceFiles: toJson(record.sourceFiles),
    result: toJson(record.result),
    completedAt: record.completedAt,
    expiresAt: record.expiresAt,
    processingAttemptId,
    processingGeneration,
  };
}
