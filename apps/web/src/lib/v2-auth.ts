import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  assertCompanyRole,
  AuthorizationError,
  WorkflowRuleError,
  ReconciliationConfigurationError,
  type ActorContext,
  type CompanyRole,
} from "@conciliacao/core";

const roleSchema = z.enum(["PREPARER", "REVIEWER", "ADMIN", "AUDITOR"]);
const tokenPayloadSchema = z.object({
  actorId: z.string().trim().min(1).max(120),
  companyRoles: z.record(z.string().trim().min(1), z.array(roleSchema).min(1)),
  exp: z.number().int().positive(),
});

export class V2HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "V2HttpError";
  }
}

export function createV2ActorToken(
  payload: z.infer<typeof tokenPayloadSchema>,
  secret: string,
): string {
  const encoded = Buffer.from(JSON.stringify(tokenPayloadSchema.parse(payload))).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifyV2ActorToken(token: string, secret = requiredSecret()): ActorContext {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) throw unauthorized();
  const expected = Buffer.from(sign(encoded, secret), "base64url");
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw unauthorized();
  try {
    const payload = tokenPayloadSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
    if (payload.exp <= Math.floor(Date.now() / 1000)) throw unauthorized("TOKEN_EXPIRED", "A credencial expirou");
    return { actorId: payload.actorId, companyRoles: payload.companyRoles };
  } catch (error) {
    if (error instanceof V2HttpError) throw error;
    throw unauthorized();
  }
}

export function requireV2Actor(
  request: NextRequest,
  companyId?: string,
  roles: readonly CompanyRole[] = ["PREPARER", "REVIEWER", "ADMIN", "AUDITOR"],
): ActorContext {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw unauthorized();
  const actor = verifyV2ActorToken(authorization.slice(7));
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
  console.error(JSON.stringify({ event: "v2_request_failed", errorType: error instanceof Error ? error.name : "Unknown" }));
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "Não foi possível concluir a operação" } },
    { status: 500 },
  );
}

function requiredSecret(): string {
  const secret = process.env.V2_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new V2HttpError(503, "AUTH_NOT_CONFIGURED", "Autorização V2 não configurada");
  return secret;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function unauthorized(code = "UNAUTHORIZED", message = "Credencial ausente ou inválida"): V2HttpError {
  return new V2HttpError(401, code, message);
}
