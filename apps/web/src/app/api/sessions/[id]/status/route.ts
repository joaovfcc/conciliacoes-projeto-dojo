import type { NextRequest } from "next/server";
import { authorized, jsonError, publicSession, withRegisteredAccountMappings } from "@/lib/runtime";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json(
      { session: publicSession(await withRegisteredAccountMappings(await authorized(request, id))) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}
