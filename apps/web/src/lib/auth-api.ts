import { AuthError, type AuthenticatedUser } from "@conciliacao/core";
import type { RateLimiter, RateLimitPolicy } from "@conciliacao/runtime";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { AccessTokenClaims } from "./auth-jwt";

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});
const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
});

interface AuthGrant {
  sessionId: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: AuthenticatedUser;
}

export interface WebAuthService {
  login(email: string, password: string): Promise<AuthGrant>;
  refresh(refreshToken: string): Promise<AuthGrant>;
  resolveSession(sessionId: string, userId: string): Promise<AuthenticatedUser | null>;
  logout(sessionId: string): Promise<void>;
  changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void>;
}

export interface AuthHttpDependencies {
  auth: WebAuthService;
  signAccess(claims: AccessTokenClaims): Promise<{ token: string; expiresAt: Date }>;
  verifyAccess(token: string): Promise<AccessTokenClaims>;
  rateLimiter: RateLimiter | (() => RateLimiter);
}

const refreshPolicy: RateLimitPolicy = { name: "auth-refresh", limit: 30, windowMs: 5 * 60 * 1000 };
const passwordPolicy: RateLimitPolicy = { name: "auth-password", limit: 5, windowMs: 60 * 60 * 1000 };

export function createAuthHandlers(dependencies: AuthHttpDependencies) {
  return {
    login: (request: NextRequest) => handle(async () => {
      assertOrigin(request);
      const body = loginSchema.parse(await request.json());
      return grantResponse(await dependencies.auth.login(body.email, body.password), dependencies);
    }),
    refresh: (request: NextRequest) => handle(async () => {
      assertOrigin(request);
      const refreshToken = request.cookies.get(refreshCookieName())?.value;
      if (!refreshToken) throw new AuthHttpError(401, "SESSION_INVALID", "Sessão inválida ou expirada");
      await consumeLimit(dependencies.rateLimiter, refreshPolicy, `ip:${clientAddress(request)}`);
      await consumeLimit(dependencies.rateLimiter, refreshPolicy, `token:${refreshToken}`);
      return grantResponse(await dependencies.auth.refresh(refreshToken), dependencies);
    }),
    me: (request: NextRequest) => handle(async () => {
      const claims = await requireAccess(request, dependencies);
      const user = await dependencies.auth.resolveSession(claims.sessionId, claims.userId);
      if (!user) throw new AuthHttpError(401, "SESSION_INVALID", "Sessão inválida ou expirada");
      return noStoreJson({ user });
    }),
    logout: (request: NextRequest) => handle(async () => {
      assertOrigin(request);
      const claims = await requireAccess(request, dependencies);
      await dependencies.auth.logout(claims.sessionId);
      return clearRefreshCookie(new NextResponse(null, { status: 204, headers: noStoreHeaders() }));
    }),
    changePassword: (request: NextRequest) => handle(async () => {
      assertOrigin(request);
      const claims = await requireAccess(request, dependencies);
      await consumeLimit(dependencies.rateLimiter, passwordPolicy, `user:${claims.userId}`);
      const body = passwordSchema.parse(await request.json());
      await dependencies.auth.changePassword(claims.userId, body.currentPassword, body.newPassword);
      return clearRefreshCookie(new NextResponse(null, { status: 204, headers: noStoreHeaders() }));
    }),
  };
}

export class AuthHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "AuthHttpError";
  }
}

async function grantResponse(grant: AuthGrant, dependencies: AuthHttpDependencies): Promise<NextResponse> {
  const access = await dependencies.signAccess({ userId: grant.user.id, sessionId: grant.sessionId });
  const response = NextResponse.json({
    accessToken: access.token,
    accessExpiresAt: access.expiresAt.toISOString(),
    user: grant.user,
  }, { headers: noStoreHeaders() });
  response.cookies.set(refreshCookieName(), grant.refreshToken, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/api/auth",
    expires: grant.refreshExpiresAt,
  });
  return response;
}

async function requireAccess(request: NextRequest, dependencies: AuthHttpDependencies): Promise<AccessTokenClaims> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new AuthHttpError(401, "UNAUTHORIZED", "Credencial ausente ou inválida");
  }
  try {
    return await dependencies.verifyAccess(authorization.slice(7));
  } catch {
    throw new AuthHttpError(401, "UNAUTHORIZED", "Credencial ausente ou inválida");
  }
}

function assertOrigin(request: NextRequest): void {
  const configured = new URL(process.env.APP_ORIGIN || "http://localhost:3000").origin;
  const origin = request.headers.get("origin");
  if (origin !== configured) throw new AuthHttpError(403, "INVALID_ORIGIN", "Origem não autorizada");
}

async function handle(action: () => Promise<Response>): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof AuthHttpError) {
      return errorResponse(error.status, error.code, error.message, error.retryAfterSeconds);
    }
    if (error instanceof z.ZodError) return errorResponse(400, "INVALID_REQUEST", "Dados de entrada inválidos");
    if (error instanceof AuthError) {
      const status = error.code === "INVALID_PASSWORD" ? 400 : 401;
      const message = error.code === "INVALID_CREDENTIALS" ? "E-mail ou senha inválidos" : error.message;
      return errorResponse(status, error.code, message);
    }
    console.error(JSON.stringify({ event: "auth_request_failed", errorType: error instanceof Error ? error.name : "Unknown" }));
    return errorResponse(500, "INTERNAL_ERROR", "Não foi possível concluir a autenticação");
  }
}

function errorResponse(status: number, code: string, message: string, retryAfterSeconds?: number): NextResponse {
  const headers = new Headers(noStoreHeaders());
  if (retryAfterSeconds !== undefined) headers.set("Retry-After", String(retryAfterSeconds));
  return NextResponse.json({ error: { code, message, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) } }, { status, headers });
}

function noStoreJson(body: unknown): NextResponse {
  return NextResponse.json(body, { headers: noStoreHeaders() });
}

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store" };
}

function clearRefreshCookie(response: NextResponse): NextResponse {
  response.cookies.set(refreshCookieName(), "", {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/api/auth",
    expires: new Date(0),
  });
  return response;
}

function refreshCookieName(): string {
  return "conciliacao-refresh";
}

function cookieSecure(): boolean {
  return process.env.AUTH_COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";
}

async function consumeLimit(source: RateLimiter | (() => RateLimiter), policy: RateLimitPolicy, key: string): Promise<void> {
  try {
    const limiter = typeof source === "function" ? source() : source;
    const result = await limiter.consume(policy, key);
    if (!result.allowed) {
      const minutes = Math.ceil(result.retryAfterSeconds / 60);
      const timeDescription =
        result.retryAfterSeconds < 60
          ? `${result.retryAfterSeconds} segundos`
          : `${minutes} minuto${minutes === 1 ? "" : "s"}`;
      throw new AuthHttpError(
        429,
        "RATE_LIMITED",
        `Limite de 5 tentativas excedido. Aguarde ${timeDescription} em standby antes de tentar novamente.`,
        result.retryAfterSeconds,
      );
    }
  } catch (error) {
    if (error instanceof AuthHttpError) throw error;
    throw new AuthHttpError(503, "RATE_LIMIT_UNAVAILABLE", "Proteção contra abuso indisponível", 60);
  }
}

function clientAddress(request: NextRequest): string {
  if (process.env.TRUST_PROXY !== "true") return "direct";
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}
