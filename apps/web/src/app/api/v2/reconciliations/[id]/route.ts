import type { NextRequest } from "next/server";
import { PrismaReconciliationRunRepository, prisma } from "@conciliacao/core";
import { requireV2Actor, v2RouteError } from "../../../../../lib/v2-auth";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireV2Actor(_request);
    const { id } = await params;
    const runRepo = new PrismaReconciliationRunRepository(prisma);
    const run = await runRepo.findById(id);

    if (!run) {
      return Response.json({ error: "Reconciliation Run not found" }, { status: 404 });
    }
    await requireV2Actor(_request, run.companyId);

    return Response.json({ run }, { status: 200 });
  } catch (error) { return v2RouteError(error); }
}
