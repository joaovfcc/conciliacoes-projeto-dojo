import { createHash } from "node:crypto";
import { PrismaCompletedReconciliationRepository, PrismaCompanyRepository, prisma, type ActorContext, type Company } from "@conciliacao/core";
import { createObjectStore, createSessionStore, loadRuntimeConfig, PublicRuntimeError, RuntimeServices, publicSession, type RateLimiter, type SessionStore } from "@conciliacao/runtime";
import type { NextRequest } from "next/server";
import { rateLimiter } from "./auth-runtime";
import { requireV2Actor, V2HttpError } from "./v2-auth";

const globalRuntime = globalThis as typeof globalThis & { reconciliationRuntime?: RuntimeServices; sweepStarted?: boolean };

export function runtime(): RuntimeServices {
  if (!globalRuntime.reconciliationRuntime) {
    const config = loadRuntimeConfig();
    globalRuntime.reconciliationRuntime = new RuntimeServices(
      config,
      createSessionStore(config),
      createObjectStore(config),
      new PrismaCompletedReconciliationRepository(prisma),
    );
  }
  if (!globalRuntime.sweepStarted) {
    globalRuntime.sweepStarted = true;
    setInterval(() => {
      void globalRuntime.reconciliationRuntime?.sweep().catch((error) => console.error(JSON.stringify({
        event: "runtime_sweep_failed",
        errorType: error instanceof Error ? error.name : "Unknown",
        timestamp: new Date().toISOString(),
      })));
    }, 30_000).unref();
  }
  return globalRuntime.reconciliationRuntime;
}

export async function authorized(request: NextRequest, id: string) {
  return authorizeReconciliationSession(request, id, {
    resolveActor: requireV2Actor,
    sessions: runtime().sessions,
  });
}

interface ReconciliationAccessDependencies {
  resolveActor(request: NextRequest): Promise<ActorContext>;
  sessions: SessionStore;
}

export async function authorizeReconciliationSession(
  request: NextRequest,
  id: string,
  dependencies: ReconciliationAccessDependencies,
) {
  const actor = await dependencies.resolveActor(request);
  const token = request.headers.get("x-reconciliation-session-token");
  if (!token) throw sessionUnauthorized();
  const session = await dependencies.sessions.authorize(id, token);
  if (!session || session.actorId !== actor.actorId) throw sessionUnauthorized();
  if (!(actor.companyRoles[session.companyId] ?? []).some((role) => ["PREPARER", "ADMIN"].includes(role))) {
    throw sessionUnauthorized();
  }
  return session;
}

interface CreateReconciliationSessionDependencies extends ReconciliationAccessDependencies {
  rateLimiter: RateLimiter | (() => RateLimiter);
  maxSessionsPerHour: number;
  clientKey(request: NextRequest): string;
  findCompany(companyId: string): Promise<Company | null>;
}

export async function createReconciliationSession(
  request: NextRequest,
  dependencies: CreateReconciliationSessionDependencies,
): Promise<Response> {
  const actor = await dependencies.resolveActor(request);
  const input = await parseSessionCreation(request);
  const roles = actor.companyRoles[input.companyId] ?? [];
  if (!roles.some((role) => role === "PREPARER" || role === "ADMIN")) {
    throw new V2HttpError(403, "FORBIDDEN", "Acesso negado para iniciar conciliação nesta empresa");
  }
  const company = await dependencies.findCompany(input.companyId);
  if (!company || company.status !== "ACTIVE") {
    throw new V2HttpError(404, "COMPANY_NOT_FOUND", "Empresa não encontrada ou inativa");
  }
  const key = dependencies.clientKey(request);
  const policy = { name: "reconciliation-create", limit: dependencies.maxSessionsPerHour, windowMs: 3_600_000 };
  const limiter = resolveRateLimiter(dependencies.rateLimiter);
  await consumeCreationLimit(limiter, policy, `user:${actor.actorId}`);
  await consumeCreationLimit(limiter, policy, `client:${key}`);
  const created = await dependencies.sessions.create(key, actor.actorId, company.organizationId, company.id);
  return Response.json(created, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function createAuthenticatedSession(request: NextRequest): Promise<Response> {
  const services = runtime();
  return createReconciliationSession(request, {
    resolveActor: requireV2Actor,
    sessions: services.sessions,
    rateLimiter,
    maxSessionsPerHour: services.config.maxSessionsPerHour,
    clientKey,
    findCompany: (companyId) => new PrismaCompanyRepository(prisma).findById(companyId),
  });
}

export function clientKey(request: NextRequest): string {
  const config = runtime().config;
  const raw = config.trustProxy ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown" : "direct";
  return createHash("sha256").update(`${process.env.IP_HASH_SALT || "local-development"}|${raw}`).digest("hex");
}

export function jsonError(error: unknown): Response {
  if (error instanceof PublicRuntimeError) {
    const init: ResponseInit = { status: error.status };
    if (error.retryAfterSeconds !== undefined) init.headers = { "Retry-After": String(error.retryAfterSeconds) };
    return Response.json({ error: { code: error.code, message: error.message } }, init);
  }
  if (error instanceof V2HttpError) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  console.error(error);
  console.error(JSON.stringify({ event: "request_failed", code: "INTERNAL_ERROR", timestamp: new Date().toISOString() }));
  return Response.json({ error: { code: "INTERNAL_ERROR", message: "Não foi possível concluir a operação. Tente novamente." } }, { status: 500 });
}

export { publicSession };

function sessionUnauthorized(): PublicRuntimeError {
  return new PublicRuntimeError("SESSAO_NAO_AUTORIZADA", "A sessão não está disponível neste navegador.", 401);
}

async function parseSessionCreation(request: NextRequest): Promise<{ companyId: string }> {
  try {
    const body = await request.json() as { companyId?: unknown };
    if (typeof body.companyId === "string" && body.companyId.trim()) return { companyId: body.companyId.trim() };
  } catch {
    // Invalid JSON is reported as a bounded public request error.
  }
  throw new PublicRuntimeError("INVALID_REQUEST", "Selecione uma empresa para iniciar a conciliação.", 400);
}

function resolveRateLimiter(source: RateLimiter | (() => RateLimiter)): RateLimiter {
  try {
    return typeof source === "function" ? source() : source;
  } catch {
    throw new PublicRuntimeError("RATE_LIMIT_UNAVAILABLE", "Proteção contra abuso indisponível", 503, 60);
  }
}

async function consumeCreationLimit(
  limiter: RateLimiter,
  policy: { name: string; limit: number; windowMs: number },
  key: string,
): Promise<void> {
  try {
    const result = await limiter.consume(policy, key);
    if (!result.allowed) {
      throw new PublicRuntimeError(
        "RATE_LIMITED",
        `Tente novamente em ${result.retryAfterSeconds} segundos`,
        429,
        result.retryAfterSeconds,
      );
    }
  } catch (error) {
    if (error instanceof PublicRuntimeError) throw error;
    throw new PublicRuntimeError("RATE_LIMIT_UNAVAILABLE", "Proteção contra abuso indisponível", 503, 60);
  }
}
