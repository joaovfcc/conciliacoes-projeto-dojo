import type { Prisma, PrismaClient } from "@prisma/client";
import type { ReconciliationRunRepository } from "../domain/ReconciliationRunRepository.js";
import type {
  ExceptionStatus,
  ExceptionType,
  ReconciliationRun,
  ReconciliationRunStatus,
} from "../domain/ReconciliationRun.js";
import { decimalString } from "../../shared/domain/Decimal.js";

type RunRecord = Prisma.ReconciliationRunGetPayload<{
  include: { matchGroups: true; exceptions: { include: { evidences: { select: { id: true } } } } };
}>;

export class PrismaReconciliationRunRepository implements ReconciliationRunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(run: ReconciliationRun): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.reconciliationRun.upsert({
        where: { id: run.id },
        update: {
          status: run.status,
          reviewerId: run.reviewerId ?? null,
          comments: run.comments ?? null,
          submittedAt: run.submittedAt ?? null,
          approvedAt: run.approvedAt ?? null,
          closedAt: run.closedAt ?? null,
        },
        create: {
          id: run.id,
          companyId: run.companyId,
          profileId: run.profileId,
          periodId: run.periodId,
          preparerId: run.preparerId,
          status: run.status,
          reviewerId: run.reviewerId ?? null,
          comments: run.comments ?? null,
          submittedAt: run.submittedAt ?? null,
          approvedAt: run.approvedAt ?? null,
          closedAt: run.closedAt ?? null,
        },
      });

      await tx.matchGroup.deleteMany({
        where: { reconciliationRunId: run.id, id: { notIn: run.matchGroups.map((group) => group.id) } },
      });
      for (const group of run.matchGroups) {
        const data = {
            id: group.id,
            reconciliationRunId: group.reconciliationRunId,
            ruleId: group.ruleId,
            cardinality: group.cardinality,
            confidence: group.confidence,
            matchedStatementIds: group.matchedStatementIds,
            matchedLedgerIds: group.matchedLedgerIds,
            dateDifferenceDays: group.dateDifferenceDays ?? null,
            amountDifference: group.amountDifference ?? null,
            descriptionSimilarity: group.descriptionSimilarity ?? null,
            status: group.status,
            actorId: group.actorId ?? null,
            createdAt: group.createdAt,
        };
        await tx.matchGroup.upsert({
          where: { id: group.id },
          create: data,
          update: {
            ruleId: data.ruleId,
            cardinality: data.cardinality,
            confidence: data.confidence,
            matchedStatementIds: data.matchedStatementIds,
            matchedLedgerIds: data.matchedLedgerIds,
            dateDifferenceDays: data.dateDifferenceDays,
            amountDifference: data.amountDifference,
            descriptionSimilarity: data.descriptionSimilarity,
            status: data.status,
            actorId: data.actorId,
          },
        });
      }

      await tx.reconciliationException.deleteMany({
        where: { reconciliationRunId: run.id, id: { notIn: run.exceptions.map((exception) => exception.id) } },
      });
      for (const exception of run.exceptions) {
        const data = {
            id: exception.id,
            reconciliationRunId: exception.reconciliationRunId,
            type: exception.type,
            status: exception.status,
            assignedTo: exception.assignedTo ?? null,
            dueDate: exception.dueDate ?? null,
            resolutionCode: exception.resolutionCode ?? null,
            explanation: exception.explanation ?? null,
            statementId: exception.statementId ?? null,
            ledgerId: exception.ledgerId ?? null,
            candidateIds: exception.candidateIds,
            createdAt: exception.createdAt,
            updatedAt: exception.updatedAt,
        };
        await tx.reconciliationException.upsert({
          where: { id: exception.id },
          create: data,
          update: {
            type: data.type,
            status: data.status,
            assignedTo: data.assignedTo,
            dueDate: data.dueDate,
            resolutionCode: data.resolutionCode,
            explanation: data.explanation,
            statementId: data.statementId,
            ledgerId: data.ledgerId,
            candidateIds: data.candidateIds,
          },
        });
      }
    });
  }

  async findById(id: string): Promise<ReconciliationRun | null> {
    const record = await this.prisma.reconciliationRun.findUnique({
      where: { id },
      include: { matchGroups: true, exceptions: { include: { evidences: { select: { id: true } } } } },
    });
    return record ? this.mapToDomain(record) : null;
  }

  async findByCompanyId(companyId: string): Promise<ReconciliationRun[]> {
    const records = await this.prisma.reconciliationRun.findMany({
      where: { companyId },
      include: { matchGroups: true, exceptions: { include: { evidences: { select: { id: true } } } } },
      orderBy: { createdAt: "desc" },
    });
    return records.map((record) => this.mapToDomain(record));
  }

  private mapToDomain(record: RunRecord): ReconciliationRun {
    return {
      id: record.id,
      companyId: record.companyId,
      profileId: record.profileId,
      periodId: record.periodId,
      preparerId: record.preparerId,
      status: record.status as ReconciliationRunStatus,
      ...(record.reviewerId ? { reviewerId: record.reviewerId } : {}),
      ...(record.comments ? { comments: record.comments } : {}),
      ...(record.submittedAt ? { submittedAt: record.submittedAt } : {}),
      ...(record.approvedAt ? { approvedAt: record.approvedAt } : {}),
      ...(record.closedAt ? { closedAt: record.closedAt } : {}),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      matchGroups: record.matchGroups.map((group) => ({
        id: group.id,
        reconciliationRunId: group.reconciliationRunId,
        ruleId: group.ruleId,
        cardinality: group.cardinality as "ONE_TO_ONE" | "ONE_TO_MANY" | "MANY_TO_ONE" | "MANY_TO_MANY",
        confidence: group.confidence,
        matchedStatementIds: group.matchedStatementIds,
        matchedLedgerIds: group.matchedLedgerIds,
        ...(group.dateDifferenceDays !== null ? { dateDifferenceDays: group.dateDifferenceDays } : {}),
        ...(group.amountDifference !== null ? { amountDifference: decimalString(group.amountDifference.toString()) } : {}),
        ...(group.descriptionSimilarity !== null ? { descriptionSimilarity: group.descriptionSimilarity } : {}),
        status: group.status as "AUTO_CONFIRMED" | "SUGGESTED" | "MANUALLY_CONFIRMED" | "REJECTED",
        ...(group.actorId ? { actorId: group.actorId } : {}),
        createdAt: group.createdAt,
      })),
      exceptions: record.exceptions.map((exception) => ({
        id: exception.id,
        reconciliationRunId: exception.reconciliationRunId,
        type: exception.type as ExceptionType,
        status: exception.status as ExceptionStatus,
        ...(exception.assignedTo ? { assignedTo: exception.assignedTo } : {}),
        ...(exception.dueDate ? { dueDate: exception.dueDate } : {}),
        ...(exception.resolutionCode ? { resolutionCode: exception.resolutionCode } : {}),
        ...(exception.explanation ? { explanation: exception.explanation } : {}),
        ...(exception.statementId ? { statementId: exception.statementId } : {}),
        ...(exception.ledgerId ? { ledgerId: exception.ledgerId } : {}),
        candidateIds: exception.candidateIds,
        evidenceIds: exception.evidences.map((evidence) => evidence.id),
        createdAt: exception.createdAt,
        updatedAt: exception.updatedAt,
      })),
    };
  }
}
