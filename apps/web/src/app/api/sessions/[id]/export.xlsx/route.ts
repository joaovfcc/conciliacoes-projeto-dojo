import type { NextRequest } from "next/server";
import { authorized, jsonError, runtime } from "@/lib/runtime";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) { try { const { id } = await context.params; const session = await authorized(request, id); const buffer = await runtime().export(session); return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="CONCILIACAO_${session.result?.period ?? "RESULTADO"}.xlsx"`, "Cache-Control": "no-store, max-age=0", "Content-Length": String(buffer.length) } }); } catch (error) { return jsonError(error); } }
