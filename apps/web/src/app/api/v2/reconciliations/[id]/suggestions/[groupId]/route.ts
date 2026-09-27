import type { NextRequest } from "next/server";
import {
  PrismaAuditRepository,
  PrismaReconciliationRunRepository,
  SuggestionDecisionService,
  prisma,
} from "@conciliacao/core";
import { z } from "zod";
import { requireV2Actor, v2RouteError } from "../../../../../../../lib/v2-auth";

const commandSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  comment: z.string().trim().min(1).max(4_000).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string }> },
) {
  try {
    const { id, groupId } = await params;
    const command = commandSchema.parse(await request.json());
    const runs = new PrismaReconciliationRunRepository(prisma);
    const run = await runs.findById(id);
    if (!run) return Response.json({ error: { code: "NOT_FOUND", message: "Conciliação não encontrada" } }, { status: 404 });

    const actor = await requireV2Actor(request, run.companyId, ["REVIEWER", "ADMIN"]);
    const suggestion = await new SuggestionDecisionService(runs, new PrismaAuditRepository(prisma)).execute(
      id,
      groupId,
      command.action,
      command.comment ? { comment: command.comment } : {},
      actor,
    );
    return Response.json({ success: true, suggestion });
  } catch (error) {
    return v2RouteError(error);
  }
}
