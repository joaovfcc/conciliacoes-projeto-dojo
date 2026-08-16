import type { NextRequest } from "next/server";
import { authHandlers } from "@/lib/auth-runtime";

export async function GET(request: NextRequest) {
  return authHandlers().me(request);
}
