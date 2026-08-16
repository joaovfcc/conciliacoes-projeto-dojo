import type { NextRequest } from "next/server";
import { createAuthenticatedSession, jsonError } from "@/lib/runtime";

export async function POST(request: NextRequest) {
  try {
    return await createAuthenticatedSession(request);
  } catch (error) { return jsonError(error); }
}
