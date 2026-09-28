import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  if (process.env.LOCAL_MODE === "true" || !process.env.DATABASE_URL) {
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const { authHandlers } = await import("@/lib/auth-runtime");
  return authHandlers().changePassword(request);
}
