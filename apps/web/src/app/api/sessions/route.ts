import { PublicRuntimeError } from "@conciliacao/runtime";
import type { NextRequest } from "next/server";
import { clientKey, jsonError, runtime } from "@/lib/runtime";

export async function POST(request: NextRequest) {
  try {
    const services = runtime(); const key = clientKey(request);
    return Response.json(await services.sessions.create(key), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
