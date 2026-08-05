import type { NextRequest } from "next/server";
import { authorized, jsonError, runtime } from "@/lib/runtime";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) { try { const { id } = await context.params; const session = await authorized(request, id); await runtime().heartbeat(session); return new Response(null, { status: 204 }); } catch (error) { return jsonError(error); } }
