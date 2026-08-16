import type { NextRequest } from "next/server";
import {
  ImportStatementUseCase,
  PrismaAuditRepository,
  PrismaBankAccountRepository,
  PrismaEvidenceRepository,
  PrismaImportBatchRepository,
  PrismaLayoutRepository,
  PrismaTransactionRepository,
  prisma,
} from "@conciliacao/core";
import { requireV2Actor, v2RouteError } from "../../../../../lib/v2-auth";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const companyId = formData.get("companyId") as string | null;
    const accountId = formData.get("accountId") as string | null;

    if (!file || !companyId?.trim() || !accountId?.trim()) {
      return Response.json(
        { error: "Missing required fields: file, companyId, accountId" },
        { status: 400 }
      );
    }
    const actor = await requireV2Actor(request, companyId, ["PREPARER", "ADMIN"]);

    const buffer = Buffer.from(await file.arrayBuffer());

    const transactionRepo = new PrismaTransactionRepository(prisma);
    const layoutRepo = new PrismaLayoutRepository(prisma);
    const useCase = new ImportStatementUseCase(
      transactionRepo,
      layoutRepo,
      new PrismaImportBatchRepository(prisma),
      new PrismaAuditRepository(prisma),
      new PrismaEvidenceRepository(prisma),
      new PrismaBankAccountRepository(prisma),
    );
    const result = await useCase.execute({
      companyId,
      accountId,
      originalName: file.name,
      contentType: file.type || "application/octet-stream",
      fileBuffer: buffer,
      actorId: actor.actorId,
      allowDuplicate: formData.get("allowDuplicate") === "true",
    });

    return Response.json(result, {
      status: result.status === "REJECTED" ? 422 : 200
    });
  } catch (error) { return v2RouteError(error); }
}
