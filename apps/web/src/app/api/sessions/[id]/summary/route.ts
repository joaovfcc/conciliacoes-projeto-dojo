import type { NextRequest } from "next/server";
import { authorized, jsonError } from "@/lib/runtime";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) { try { const { id } = await context.params; const session = await authorized(request, id); return Response.json({ summaries: session.result?.summaries ?? [] }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return jsonError(error); } }
