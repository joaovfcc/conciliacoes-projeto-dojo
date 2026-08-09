import type { NextRequest } from "next/server";
import { PrismaAuditRepository, PrismaReconciliationRunRepository, WorkflowService, prisma } from "@conciliacao/core";
import { z } from "zod";
import { requireV2Actor, v2RouteError } from "../../../../../../lib/v2-auth";

const commandSchema = z.object({
  action: z.enum(["SUBMIT", "START_REVIEW", "APPROVE", "REJECT", "REOPEN", "CLOSE"]),
  comment: z.string().trim().min(1).max(2_000).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const data = commandSchema.parse(await request.json());
    const runRepo = new PrismaReconciliationRunRepository(prisma);
    const run = await runRepo.findById(id);

    if (!run) {
      return Response.json({ error: "Reconciliation Run not found" }, { status: 404 });
    }

    const actor = requireV2Actor(request, run.companyId);
    const updated = await new WorkflowService(runRepo, new PrismaAuditRepository(prisma)).transition(
      id,
      data.action,
      actor,
      data.comment,
    );

    return Response.json({ success: true, run: updated }, { status: 200 });
  } catch (error) { return v2RouteError(error); }
}
