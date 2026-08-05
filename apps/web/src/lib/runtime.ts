import { createHash } from "node:crypto";
import { createObjectStore, createSessionStore, loadRuntimeConfig, PublicRuntimeError, RuntimeServices, publicSession } from "@conciliacao/runtime";
import type { NextRequest } from "next/server";

const globalRuntime = globalThis as typeof globalThis & { reconciliationRuntime?: RuntimeServices; sweepStarted?: boolean };

export function runtime(): RuntimeServices {
  if (!globalRuntime.reconciliationRuntime) {
    const config = loadRuntimeConfig();
    globalRuntime.reconciliationRuntime = new RuntimeServices(config, createSessionStore(config), createObjectStore(config));
  }
  if (!globalRuntime.sweepStarted) {
    globalRuntime.sweepStarted = true;
    setInterval(() => { void globalRuntime.reconciliationRuntime?.sweep(); }, 30_000).unref();
  }
  return globalRuntime.reconciliationRuntime;
}

export async function authorized(request: NextRequest, id: string) {
  const token = bearer(request);
  if (!token) throw new PublicRuntimeError("SESSAO_NAO_AUTORIZADA", "A sessão não está disponível neste navegador.", 401);
  const session = await runtime().sessions.authorize(id, token);
  if (!session) throw new PublicRuntimeError("SESSAO_NAO_AUTORIZADA", "A sessão não está disponível neste navegador.", 401);
  return session;
}

export function bearer(request: NextRequest): string | null {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7) : null;
}

export function clientKey(request: NextRequest): string {
  const config = runtime().config;
  const raw = config.trustProxy ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown" : "direct";
  return createHash("sha256").update(`${process.env.IP_HASH_SALT || "local-development"}|${raw}`).digest("hex");
}

export function jsonError(error: unknown): Response {
  if (error instanceof PublicRuntimeError) {
    const init: ResponseInit = { status: error.status };
    if (error.status === 429 || error.status === 503) init.headers = { "Retry-After": "300" };
    return Response.json({ error: { code: error.code, message: error.message } }, init);
  }
  console.error(JSON.stringify({ event: "request_failed", code: "INTERNAL_ERROR", timestamp: new Date().toISOString() }));
  return Response.json({ error: { code: "INTERNAL_ERROR", message: "Não foi possível concluir a operação. Tente novamente." } }, { status: 500 });
}

export { publicSession };
