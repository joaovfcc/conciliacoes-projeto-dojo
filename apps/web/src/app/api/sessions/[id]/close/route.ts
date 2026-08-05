import type { NextRequest } from "next/server";
import { authorized, bearer, jsonError, runtime } from "@/lib/runtime";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    let session;
    if (bearer(request)) session = await authorized(request, id);
    else {
      const payload = JSON.parse(await request.text()) as { token?: string };
      session = payload.token ? await runtime().sessions.authorize(id, payload.token) : null;
      if (!session) return new Response(null, { status: 401 });
    }
    await runtime().cleanup(session);
    return new Response(null, { status: 204 });
  } catch (error) { return jsonError(error); }
}
