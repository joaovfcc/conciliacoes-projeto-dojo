import type { NextRequest } from "next/server";
import { authorized, jsonError, runtime } from "@/lib/runtime";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params; const session = await authorized(request, id); const input = await request.json(); const result = await runtime().registerUpload(session, input); return Response.json({ file: result.file, upload: result.uploadUrl ? { mode: "presigned", url: result.uploadUrl } : { mode: "local", url: `/api/sessions/${id}/uploads/${result.file.id}` } }, { status: 201 }); }
  catch (error) { return jsonError(error); }
}
