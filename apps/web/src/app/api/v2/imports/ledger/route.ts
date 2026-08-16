import type { NextRequest } from "next/server";
import {
  ImportLedgerUseCase,
  PrismaAuditRepository,
  PrismaEvidenceRepository,
  PrismaImportBatchRepository,
  PrismaLedgerRepository,
  prisma,
} from "@conciliacao/core";
import { z } from "zod";
import { requireV2Actor, v2RouteError } from "../../../../../lib/v2-auth";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const companyId = formData.get("companyId") as string | null;

    if (!file || !companyId?.trim()) {
      return Response.json(
        { error: "Missing required fields: file, companyId" },
        { status: 400 }
      );
    }
    const actor = await requireV2Actor(request, companyId, ["PREPARER", "ADMIN"]);

    const buffer = Buffer.from(await file.arrayBuffer());

    const ledgerRepo = new PrismaLedgerRepository(prisma);
    const useCase = new ImportLedgerUseCase(
      ledgerRepo,
      new PrismaImportBatchRepository(prisma),
      new PrismaAuditRepository(prisma),
      new PrismaEvidenceRepository(prisma),
    );
    const mappingsValue = formData.get("ledgerAccountMappings");
    const ledgerAccountMappings = mappingsValue
      ? z.record(z.string().min(1), z.string().min(1)).parse(JSON.parse(String(mappingsValue)))
      : undefined;

    const result = await useCase.execute({
      originalName: file.name,
      buffer,
      companyId,
      contentType: file.type || "application/octet-stream",
      actorId: actor.actorId,
      allowDuplicate: formData.get("allowDuplicate") === "true",
      ...(formData.get("ledgerAccountId") ? { ledgerAccountId: String(formData.get("ledgerAccountId")) } : {}),
      ...(ledgerAccountMappings ? { ledgerAccountMappings } : {}),
    });

    return Response.json(result, {
      status: result.success ? 200 : 422
    });
  } catch (error) { return v2RouteError(error); }
}
