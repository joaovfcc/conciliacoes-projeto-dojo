// @vitest-environment node

import { AuthError, type AuthenticatedUser } from "@conciliacao/core";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthHandlers, type AuthHttpDependencies, type WebAuthService } from "../../src/lib/auth-api";
import { signAccessToken, verifyAccessToken } from "../../src/lib/auth-jwt";

const originalEnv = { ...process.env };
const user: AuthenticatedUser = {
  id: "user-1",
  email: "owner@example.com",
  passwordChangeRequired: true,
  ownerOrganizationIds: ["org-1"],
  companyRoles: { "company-1": ["ADMIN"] },
  companies: [{ id: "company-1", organizationId: "org-1", name: "Empresa", roles: ["ADMIN"] }],
};

beforeEach(() => {
  process.env.AUTH_JWT_SECRET = "auth-api-test-secret-with-at-least-32-characters";
  process.env.AUTH_JWT_ISSUER = "test-issuer";
  process.env.AUTH_JWT_AUDIENCE = "test-audience";
  process.env.AUTH_ACCESS_TTL_SECONDS = "600";
  process.env.AUTH_COOKIE_SECURE = "false";
  process.env.APP_ORIGIN = "http://localhost:3000";
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("authentication HTTP handlers", () => {
  it("logs in with no-store response, in-memory access token and scoped HttpOnly refresh cookie", async () => {
    const auth = new FakeWebAuthService();
    const response = await handlers(auth).login(request("/api/auth/login", {
      email: "owner@example.com",
      password: "correct-password",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.user).toEqual(user);
    expect(await verifyAccessToken(body.accessToken)).toEqual({ userId: "user-1", sessionId: "session-1" });
    expect(body).not.toHaveProperty("refreshToken");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("conciliacao-refresh=refresh-token");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).toContain("Path=/api/auth");
  });

  it("rejects login from another origin before authenticating", async () => {
    const auth = new FakeWebAuthService();
    const response = await handlers(auth).login(request("/api/auth/login", {
      email: "owner@example.com",
      password: "correct-password",
    }, { origin: "https://attacker.example" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "INVALID_ORIGIN", message: "Origem não autorizada" } });
    expect(auth.loginCalls).toBe(0);
  });

  it("returns a generic credential failure without credentials in the response", async () => {
    const auth = new FakeWebAuthService();
    auth.loginError = new AuthError("INVALID_CREDENTIALS", "E-mail ou senha inválidos");
    const response = await handlers(auth).login(request("/api/auth/login", {
      email: "missing@example.com",
      password: "secret-not-returned",
    }));
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(401);
    expect(serialized).toContain("E-mail ou senha inválidos");
    expect(serialized).not.toContain("missing@example.com");
    expect(serialized).not.toContain("secret-not-returned");
  });

  it("does not limit login attempts", async () => {
    const auth = new FakeWebAuthService();
    const response = await createAuthHandlers({
      ...dependencies(auth, new FakeRateLimiter()),
      rateLimiter: () => { throw new Error("redis unavailable"); },
    }).login(request("/api/auth/login", {
      email: " OWNER@Example.COM ",
      password: "correct-password",
    }));

    expect(response.status).toBe(200);
    expect(auth.loginCalls).toBe(1);
  });

  it("rotates the refresh cookie and rejects refresh without it", async () => {
    const auth = new FakeWebAuthService();
    const withoutCookie = await handlers(auth).refresh(request("/api/auth/refresh"));
    const withCookie = await handlers(auth).refresh(request("/api/auth/refresh", undefined, {
      cookie: "conciliacao-refresh=current-refresh",
    }));

    expect(withoutCookie.status).toBe(401);
    expect(withCookie.status).toBe(200);
    expect(auth.lastRefreshToken).toBe("current-refresh");
    expect(withCookie.headers.get("set-cookie")).toContain("conciliacao-refresh=refresh-token");
  });

  it("resolves the current user from a valid access JWT and rejects missing access", async () => {
    const auth = new FakeWebAuthService();
    const access = await signAccessToken({ userId: user.id, sessionId: "session-1" });
    const valid = await handlers(auth).me(request("/api/auth/me", undefined, {
      authorization: `Bearer ${access.token}`,
    }));
    const missing = await handlers(auth).me(request("/api/auth/me"));

    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ user });
    expect(missing.status).toBe(401);
  });

  it("logs out idempotently and expires the refresh cookie", async () => {
    const auth = new FakeWebAuthService();
    const access = await signAccessToken({ userId: user.id, sessionId: "session-1" });
    const response = await handlers(auth).logout(request("/api/auth/logout", undefined, {
      authorization: `Bearer ${access.token}`,
    }));

    expect(response.status).toBe(204);
    expect(auth.loggedOutSessionId).toBe("session-1");
    expect(response.headers.get("set-cookie")).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  });

  it("changes a bounded password and revokes the browser session", async () => {
    const auth = new FakeWebAuthService();
    const access = await signAccessToken({ userId: user.id, sessionId: "session-1" });
    const response = await handlers(auth).changePassword(request("/api/auth/change-password", {
      currentPassword: "correct-password",
      newPassword: "new-password-123",
    }, { authorization: `Bearer ${access.token}` }));

    expect(response.status).toBe(204);
    expect(auth.changedPassword).toEqual({ userId: "user-1", current: "correct-password", next: "new-password-123" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

function handlers(auth: WebAuthService) {
  return createAuthHandlers(dependencies(auth, new FakeRateLimiter()));
}

function dependencies(auth: WebAuthService, rateLimiter: FakeRateLimiter): AuthHttpDependencies {
  return {
    auth,
    signAccess: signAccessToken,
    verifyAccess: verifyAccessToken,
    rateLimiter,
  };
}

class FakeRateLimiter {
  allowed = true;
  keys: string[] = [];
  failure?: Error;
  retryAfterSeconds = 300;

  async consume(_policy: { limit: number }, key: string) {
    if (this.failure) throw this.failure;
    this.keys.push(key);
    return { allowed: this.allowed, remaining: this.allowed ? 1 : 0, retryAfterSeconds: this.retryAfterSeconds };
  }
}

function request(path: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: body === undefined && path.endsWith("/me") ? "GET" : "POST",
    headers: { origin: "http://localhost:3000", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

class FakeWebAuthService implements WebAuthService {
  loginCalls = 0;
  loginError?: Error;
  lastRefreshToken?: string;
  loggedOutSessionId?: string;
  changedPassword?: { userId: string; current: string; next: string };

  async login() {
    this.loginCalls += 1;
    if (this.loginError) throw this.loginError;
    return grant();
  }

  async refresh(refreshToken: string) {
    this.lastRefreshToken = refreshToken;
    return grant();
  }

  async resolveSession() {
    return user;
  }

  async logout(sessionId: string) {
    this.loggedOutSessionId = sessionId;
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    this.changedPassword = { userId, current: currentPassword, next: newPassword };
  }
}

function grant() {
  return {
    sessionId: "session-1",
    refreshToken: "refresh-token",
    refreshExpiresAt: new Date("2026-08-14T12:00:00.000Z"),
    user,
  };
}
