import type { NextRequest } from "next/server";
import { authorized, jsonError, runtime } from "@/lib/runtime";
import type { ProcessingResult } from "@conciliacao/core";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const session = await authorized(request, id);
    const source = session.result?.results ?? [];
    const status = request.nextUrl.searchParams.get("status");
    const search = request.nextUrl.searchParams.get("search")?.toLocaleUpperCase("pt-BR") ?? "";
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? 1));
    const size = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("size") ?? 50)));
    const filtered = source.filter(
      (item) =>
        (!status ||
          item.status === status ||
          (status === "CONCILIADOS" && item.status.startsWith("CONCILIADO")) ||
          (status === "DIVERGENCIAS" && item.status.startsWith("DIVERGENCIA"))) &&
        (!search || JSON.stringify(item).toLocaleUpperCase("pt-BR").includes(search)),
    );
    return Response.json(
      { items: filtered.slice((page - 1) * size, page * size), total: filtered.length, page, size },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const session = await authorized(request, id);
    const body = (await request.json()) as { result?: ProcessingResult };
    if (!body.result) {
      return Response.json({ error: { message: "Resultado não fornecido para atualização." } }, { status: 400 });
    }
    session.result = body.result;
    const services = runtime();
    await services.sessions.save(session);
    const existingRecord = await services.completedReconciliations.findById(session.id, [session.companyId], new Date());
    if (existingRecord) {
      existingRecord.result = body.result;
      await services.completedReconciliations.save(existingRecord);
    }
    return Response.json({ success: true, result: session.result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
