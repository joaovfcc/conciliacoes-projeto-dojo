import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  assertCompanyRole,
  AuthorizationError,
  ConfigurationError,
  WorkflowRuleError,
  ReconciliationConfigurationError,
  type ActorContext,
  type CompanyRole,
  type ConfigurationCommandContext,
  type ConfigurationRole,
} from "@conciliacao/core";

import { verifyAccessToken } from "./auth-jwt";
import type { AccessTokenClaims } from "./auth-jwt";
import type { AuthenticatedUser } from "@conciliacao/core";

export class V2HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "V2HttpError";
  }
}

export async function requireV2Actor(
  request: NextRequest,
  companyId?: string,
  roles: readonly CompanyRole[] = ["PREPARER", "REVIEWER", "ADMIN", "AUDITOR"],
  dependencies?: {
    verifyAccess(token: string): Promise<AccessTokenClaims>;
    resolveSession(sessionId: string, userId: string): Promise<AuthenticatedUser | null>;
  },
): Promise<ActorContext> {
  if (process.env.LOCAL_MODE === "true" && (process.env.NODE_ENV !== "test" || !request.headers.get("authorization"))) {
    const defaultRoles: CompanyRole[] = ["PREPARER", "REVIEWER", "ADMIN", "AUDITOR"];
    return {
      actorId: "usr_local_admin",
      companyRoles: new Proxy({}, {
        get: () => defaultRoles,
      }) as unknown as Record<string, CompanyRole[]>,
    };
  }
  const deps = dependencies ?? {
    verifyAccess: verifyAccessToken,
    resolveSession: async (sessionId: string, userId: string) => {
      const { authService } = await import("./auth-runtime");
      return authService().resolveSession(sessionId, userId);
    },
  };
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw unauthorized();
  let claims;
  try {
    claims = await deps.verifyAccess(authorization.slice(7));
  } catch {
    throw unauthorized();
  }
  const user = await deps.resolveSession(claims.sessionId, claims.userId);
  if (!user) throw unauthorized("SESSION_INVALID", "Sessão inválida ou expirada");
  if (user.passwordChangeRequired) {
    throw new V2HttpError(403, "PASSWORD_CHANGE_REQUIRED", "Troque a senha temporária antes de continuar");
  }
  const actor: ActorContext = { actorId: user.id, companyRoles: user.companyRoles };
  if (companyId) {
    try {
      assertCompanyRole(actor, companyId, roles);
    } catch (error) {
      if (error instanceof AuthorizationError) {
        throw new V2HttpError(403, "FORBIDDEN", "Acesso negado para a empresa informada");
      }
      throw error;
    }
  }
  return actor;
}

const configurationRoleByCompanyRole: Readonly<Record<CompanyRole, ConfigurationRole>> = {
  PREPARER: "EDITOR",
  REVIEWER: "APPROVER",
  ADMIN: "ADMIN",
  AUDITOR: "AUDITOR",
};

export function toConfigurationCommandContext(
  request: NextRequest,
  actor: ActorContext,
  organizationId: string,
  companyId: string,
  command: { reason?: string; correlationId?: string } = {},
): ConfigurationCommandContext {
  const reason = command.reason?.trim() || request.headers.get("x-reason")?.trim();
  const correlationId = command.correlationId?.trim() || request.headers.get("x-correlation-id")?.trim();
  if (!reason) throw new V2HttpError(400, "REASON_REQUIRED", "Motivo é obrigatório");
  if (!correlationId) {
    throw new V2HttpError(400, "CORRELATION_ID_REQUIRED", "correlationId é obrigatório");
  }
  const roles = [...new Set((actor.companyRoles[companyId] ?? []).map((role) => configurationRoleByCompanyRole[role]))];
  return {
    actor: { actorId: actor.actorId, organizationRoles: { [organizationId]: roles } },
    reason,
    correlationId,
  };
}

export function v2RouteError(error: unknown): Response {
  if (error instanceof V2HttpError) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return Response.json({ error: { code: "INVALID_REQUEST", message: "Dados de entrada inválidos", issues: error.issues } }, { status: 400 });
  }
  if (error instanceof AuthorizationError) {
    return Response.json({ error: { code: "FORBIDDEN", message: error.message } }, { status: 403 });
  }
  if (error instanceof WorkflowRuleError) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: 409 });
  }
  if (error instanceof ReconciliationConfigurationError) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: 422 });
  }
  if (error instanceof ConfigurationError) {
    const status = configurationErrorStatus(error.code);
    return Response.json({ error: { code: error.code, message: error.message } }, { status });
  }
  console.error(JSON.stringify({ event: "v2_request_failed", errorType: error instanceof Error ? error.name : "Unknown" }));
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "Não foi possível concluir a operação" } },
    { status: 500 },
  );
}

function configurationErrorStatus(code: string): number {
  if (code === "FORBIDDEN") return 403;
  if (code === "NOT_FOUND" || code === "SNAPSHOT_NOT_FOUND") return 404;
  if (code.startsWith("DUPLICATE_") || code === "IDEMPOTENCY_CONFLICT" || code === "FILE_DUPLICATE"
    || code === "FILE_NAME_CONTENT_CHANGED") return 409;
  return 422;
}

function unauthorized(code = "UNAUTHORIZED", message = "Credencial ausente ou inválida"): V2HttpError {
  return new V2HttpError(401, code, message);
}
