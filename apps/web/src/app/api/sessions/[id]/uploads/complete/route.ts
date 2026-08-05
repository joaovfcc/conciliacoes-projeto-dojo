import type { NextRequest } from "next/server";
import { authorized, jsonError, runtime } from "@/lib/runtime";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params; const session = await authorized(request, id); const { fileId } = await request.json(); return Response.json({ file: await runtime().completeUpload(session, fileId) }); }
  catch (error) { return jsonError(error); }
}
