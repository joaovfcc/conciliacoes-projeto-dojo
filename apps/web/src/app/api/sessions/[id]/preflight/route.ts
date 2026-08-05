import type { NextRequest } from "next/server";
import { authorized, jsonError, publicSession, runtime } from "@/lib/runtime";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params; const session = await authorized(request, id); await runtime().enqueuePreflight(session); const updated = await runtime().sessions.get(id); return Response.json({ session: publicSession(updated!) }, { status: updated?.status === "QUEUED" ? 202 : 200 }); }
  catch (error) { return jsonError(error); }
}
