import type { NextRequest } from "next/server";
import {
  PrismaAuditRepository,
  PrismaEvidenceRepository,
  PrismaLedgerRepository,
  PrismaReconciliationConfigurationRepository,
  PrismaReconciliationRunRepository,
  PrismaTransactionRepository,
  ReconcileTransactionsUseCase,
  prisma,
} from "@conciliacao/core";
import { z } from "zod";
import { requireV2Actor, v2RouteError } from "../../../../lib/v2-auth";

const requestSchema = z.object({
  companyId: z.string().trim().min(1),
  profileId: z.string().trim().min(1),
  periodId: z.string().trim().min(1),
  valueTolerance: z.string().regex(/^\d+(?:\.\d{1,2})?$/).default("0.01"),
  dateToleranceDays: z.number().int().min(0).max(31).default(2),
  matching: z.object({
    descriptionSimilarityThreshold: z.number().min(0).max(1).optional(),
    allowOneToMany: z.boolean().default(false),
    allowManyToOne: z.boolean().default(false),
    allowManyToMany: z.boolean().default(false),
    maxGroupSize: z.number().int().min(2).max(5).default(3),
  }).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = requestSchema.parse(await request.json());
    const actor = requireV2Actor(request, body.companyId, ["PREPARER", "ADMIN"]);

    const transactionRepo = new PrismaTransactionRepository(prisma);
    const ledgerRepo = new PrismaLedgerRepository(prisma);

    const runRepo = new PrismaReconciliationRunRepository(prisma);

    const useCase = new ReconcileTransactionsUseCase(
      transactionRepo,
      ledgerRepo,
      runRepo,
      new PrismaEvidenceRepository(prisma),
      new PrismaAuditRepository(prisma),
      new PrismaReconciliationConfigurationRepository(prisma),
    );

    const result = await useCase.execute({
      companyId: body.companyId,
      profileId: body.profileId,
      periodId: body.periodId,
      preparerId: actor.actorId,
      valueTolerance: body.valueTolerance,
      dateToleranceDays: body.dateToleranceDays,
      ...(body.matching ? { matching: {
        allowOneToMany: body.matching.allowOneToMany,
        allowManyToOne: body.matching.allowManyToOne,
        allowManyToMany: body.matching.allowManyToMany,
        maxGroupSize: body.matching.maxGroupSize,
        ...(body.matching.descriptionSimilarityThreshold !== undefined
          ? { descriptionSimilarityThreshold: body.matching.descriptionSimilarityThreshold }
          : {}),
      } } : {}),
    });

    return Response.json({
      success: true,
      data: result,
      summary: {
        totalMatches: result.matchGroups.length,
        autoMatches: result.matchGroups.filter((group) => group.status === "AUTO_CONFIRMED").length,
        suggestions: result.matchGroups.filter((group) => group.status === "SUGGESTED").length,
        exceptions: result.exceptions.length,
      }
    });
  } catch (error) { return v2RouteError(error); }
}
