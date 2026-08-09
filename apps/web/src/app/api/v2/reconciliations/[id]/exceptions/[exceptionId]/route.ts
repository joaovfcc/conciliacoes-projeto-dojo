import type { NextRequest } from "next/server";
import {
  ExceptionService,
  PrismaAuditRepository,
  PrismaReconciliationRunRepository,
  prisma,
} from "@conciliacao/core";
import { z } from "zod";
import { requireV2Actor, v2RouteError } from "../../../../../../../lib/v2-auth";

const commandSchema = z.object({
  action: z.enum(["ASSIGN", "START_REVIEW", "RESOLVE", "ACCEPT_TIMING_DIFFERENCE", "REJECT"]),
  assignedTo: z.string().trim().min(1).max(120).optional(),
  dueDate: z.iso.datetime().transform((value) => new Date(value)).optional(),
  resolutionCode: z.string().trim().min(1).max(80).optional(),
  explanation: z.string().trim().min(1).max(4_000).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; exceptionId: string }> },
) {
  try {
    const { id, exceptionId } = await params;
    const command = commandSchema.parse(await request.json());
    const runs = new PrismaReconciliationRunRepository(prisma);
    const run = await runs.findById(id);
    if (!run) return Response.json({ error: { code: "NOT_FOUND", message: "Conciliação não encontrada" } }, { status: 404 });
    const actor = requireV2Actor(request, run.companyId, ["PREPARER", "REVIEWER", "ADMIN"]);
    const exception = await new ExceptionService(runs, new PrismaAuditRepository(prisma)).execute(
      id,
      exceptionId,
      command.action,
      {
        ...(command.assignedTo ? { assignedTo: command.assignedTo } : {}),
        ...(command.dueDate ? { dueDate: command.dueDate } : {}),
        ...(command.resolutionCode ? { resolutionCode: command.resolutionCode } : {}),
        ...(command.explanation ? { explanation: command.explanation } : {}),
      },
      actor,
    );
    return Response.json({ success: true, exception });
  } catch (error) {
    return v2RouteError(error);
  }
}
