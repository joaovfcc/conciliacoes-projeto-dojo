import type { NextRequest } from "next/server";
import { InspectLayoutUseCase, PrismaLayoutRepository, prisma } from "@conciliacao/core";
import { requireV2Actor, v2RouteError } from "../../../../../lib/v2-auth";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const companyId = String(form.get("companyId") ?? "").trim();
    const file = form.get("file");
    if (!companyId || !(file instanceof File)) {
      return Response.json(
        { error: { code: "INVALID_REQUEST", message: "Informe companyId e file" } },
        { status: 400 },
      );
    }
    requireV2Actor(request, companyId, ["PREPARER", "ADMIN"]);
    const result = await new InspectLayoutUseCase(new PrismaLayoutRepository(prisma)).execute(
      file.name,
      Buffer.from(await file.arrayBuffer()),
    );
    return Response.json({ inspection: result });
  } catch (error) {
    return v2RouteError(error);
  }
}
