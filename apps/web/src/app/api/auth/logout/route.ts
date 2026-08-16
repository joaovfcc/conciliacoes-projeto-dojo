import type { NextRequest } from "next/server";
import { authHandlers } from "@/lib/auth-runtime";

export async function POST(request: NextRequest) {
  return authHandlers().logout(request);
}
