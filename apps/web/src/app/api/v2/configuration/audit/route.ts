import type { NextRequest } from "next/server";
import { createConfigurationHandlers } from "@/lib/configuration-api";
import { createConfigurationRuntime } from "@/lib/configuration-runtime";

export async function GET(request: NextRequest) {
  return createConfigurationHandlers(createConfigurationRuntime()).audit(request);
}
