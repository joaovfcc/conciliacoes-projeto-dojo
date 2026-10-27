import { createHash } from "node:crypto";
import {
  PrismaCompletedReconciliationRepository,
  PrismaCompanyRepository,
  prisma,
  type ActorContext,
  type Company,
  type ConfirmProcessingRequest,
  type RegisteredAccountMapping,
} from "@conciliacao/core";
import { createObjectStore, createSessionStore, loadRuntimeConfig, PublicRuntimeError, RuntimeServices, publicSession, type RateLimiter, type ReconciliationSession, type SessionStore } from "@conciliacao/runtime";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { rateLimiter } from "./auth-runtime";
import { enforceRegisteredAccountMappings } from "./registered-account-mappings";
import { requireV2Actor, V2HttpError } from "./v2-auth";
import { findLocalCompanyById, getLocalReconciliationRepository, getLocalRegisteredAccountMappings } from "./local-store";

const globalRuntime = globalThis as typeof globalThis & { reconciliationRuntime?: RuntimeServices; sweepStarted?: boolean };

export function runtime(): RuntimeServices {
  const previous = globalRuntime.reconciliationRuntime as
    | { sessions?: SessionStore; objects?: ReturnType<typeof createObjectStore> }
    | undefined;
  if (!globalRuntime.reconciliationRuntime || !(globalRuntime.reconciliationRuntime instanceof RuntimeServices)) {
    const config = loadRuntimeConfig();
    const isLocal = process.env.LOCAL_MODE === "true" || !process.env.DATABASE_URL;
    if (isLocal) {
      delete config.redisUrl;
    }
    const historyRepo = isLocal
      ? getLocalReconciliationRepository()
      : new PrismaCompletedReconciliationRepository(prisma);
    const existingSessions = previous?.sessions;
    const existingObjects = previous?.objects;

    globalRuntime.reconciliationRuntime = new RuntimeServices(
      config,
      existingSessions ?? createSessionStore(config),
      existingObjects ?? createObjectStore(config),
      historyRepo,
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
  const token = request.headers.get("x-reconciliation-session-token");
  if (!token) throw sessionUnauthorized();
  const session = await dependencies.sessions.authorize(id, token);
  if (!session) throw sessionUnauthorized();
  if (process.env.LOCAL_MODE === "true") {
    return session;
  }
  const actor = await dependencies.resolveActor(request);
  if (session.actorId !== actor.actorId) throw sessionUnauthorized();
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
  if (process.env.LOCAL_MODE !== "true") {
    const roles = actor.companyRoles[input.companyId] ?? [];
    if (!roles.some((role) => role === "PREPARER" || role === "ADMIN")) {
      throw new V2HttpError(403, "FORBIDDEN", "Acesso negado para iniciar conciliação nesta empresa");
    }
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
  const isLocal = process.env.LOCAL_MODE === "true" || !process.env.DATABASE_URL;
  return createReconciliationSession(request, {
    resolveActor: requireV2Actor,
    sessions: services.sessions,
    rateLimiter,
    maxSessionsPerHour: services.config.maxSessionsPerHour,
    clientKey,
    findCompany: (companyId) =>
      isLocal
        ? Promise.resolve(findLocalCompanyById(companyId))
        : new PrismaCompanyRepository(prisma).findById(companyId),
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
  if (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    const typed = error as Error & { code: string; status: number; retryAfterSeconds?: number };
    const init: ResponseInit = { status: typed.status };
    if (typed.retryAfterSeconds !== undefined) {
      init.headers = { "Retry-After": String(typed.retryAfterSeconds) };
    }
    return Response.json({ error: { code: typed.code, message: typed.message } }, init);
  }
  if (error instanceof z.ZodError) {
    const firstIssue = error.issues[0]?.message || "Dados de entrada inválidos";
    return Response.json({ error: { code: "INVALID_REQUEST", message: firstIssue, issues: error.issues } }, { status: 400 });
  }
  console.error(error);
  console.error(JSON.stringify({ event: "request_failed", code: "INTERNAL_ERROR", timestamp: new Date().toISOString() }));
  return Response.json({ error: { code: "INTERNAL_ERROR", message: "Não foi possível concluir a operação. Tente novamente." } }, { status: 500 });
}

/**
 * Expõe para a pré-análise somente os vínculos ativos do cadastro da empresa.
 * O vínculo é uma sugestão de escopo lógico, não uma autorização para ignorar
 * divergências na confirmação enviada pelo usuário.
 */
export async function withRegisteredAccountMappings(session: ReconciliationSession): Promise<ReconciliationSession> {
  if (!session.preflight) return session;
  const registeredAccountMappings = await activeRegisteredAccountMappings(session.companyId);
  return {
    ...session,
    preflight: { ...session.preflight, registeredAccountMappings },
  };
}

export async function applyRegisteredAccountMappings(
  session: ReconciliationSession,
  input: ConfirmProcessingRequest,
): Promise<ConfirmProcessingRequest> {
  if (!session.preflight) return input;
  return enforceRegisteredAccountMappings(
    session.preflight,
    input,
    await activeRegisteredAccountMappings(session.companyId),
  );
}

async function activeRegisteredAccountMappings(companyId: string): Promise<RegisteredAccountMapping[]> {
  const isLocal = process.env.LOCAL_MODE === "true" || !process.env.DATABASE_URL;
  if (isLocal) {
    return getLocalRegisteredAccountMappings(companyId);
  }
  const mappings = await prisma.bankLedgerMapping.findMany({
    where: {
      companyId,
      status: "ACTIVE",
      bankAccount: { status: "ACTIVE" },
      ledgerAccount: { status: "ACTIVE" },
    },
    include: { bankAccount: true, ledgerAccount: true },
  });
  return mappings.map((mapping) => ({
    ...(mapping.bankAccount.bankCode || mapping.bankAccount.bankName
      ? { bank: mapping.bankAccount.bankCode ?? mapping.bankAccount.bankName! }
      : {}),
    ...(mapping.bankAccount.agency ? { agency: mapping.bankAccount.agency } : {}),
    ...(mapping.bankAccount.accountNumber
      ? { account: `${mapping.bankAccount.accountNumber}${mapping.bankAccount.accountDigit ? `-${mapping.bankAccount.accountDigit}` : ""}` }
      : {}),
    ledgerAccount: mapping.ledgerAccount.code,
  }));
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
