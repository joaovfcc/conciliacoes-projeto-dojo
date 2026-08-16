import type { NextRequest } from "next/server";
import {
  generateReconciliationRunXlsx,
  PrismaAuditRepository,
  PrismaEvidenceRepository,
  PrismaReconciliationRunRepository,
  prisma,
} from "@conciliacao/core";
import { requireV2Actor, v2RouteError } from "../../../../../../lib/v2-auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireV2Actor(request);
    const runs = new PrismaReconciliationRunRepository(prisma);
    const run = await runs.findById(id);
    if (!run) return Response.json({ error: { code: "NOT_FOUND", message: "Conciliação não encontrada" } }, { status: 404 });
    await requireV2Actor(request, run.companyId);
    const [evidences, audit] = await Promise.all([
      new PrismaEvidenceRepository(prisma).listByRun(id),
      new PrismaAuditRepository(prisma).list("RECONCILIATION_RUN", id),
    ]);
    const buffer = await generateReconciliationRunXlsx(run, evidences, audit);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="CONCILIACAO_${id}.xlsx"`,
        "Cache-Control": "no-store, max-age=0",
        "Content-Length": String(buffer.length),
      },
    });
  } catch (error) {
    return v2RouteError(error);
  }
}
