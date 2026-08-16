import { describe, expect, it } from "vitest";
import {
  AuthError,
  AuthService,
  Argon2PasswordHasher,
  hashToken,
  normalizeEmail,
  type AuthRepository,
  type AuthSessionRecord,
  type AuthUser,
  type AuthenticatedUser,
  type PasswordHasher,
  type RefreshRotationResult,
} from "../../src/index.js";

const now = new Date("2026-08-13T12:00:00.000Z");
const activeUser: AuthUser = {
  id: "user-1",
  email: "owner@example.com",
  passwordHash: "hash:correct-password",
  status: "ACTIVE",
  passwordChangeRequired: true,
  authVersion: 1,
};
const principal: AuthenticatedUser = {
  id: activeUser.id,
  email: activeUser.email,
  passwordChangeRequired: true,
  ownerOrganizationIds: ["org-1"],
  companyRoles: { "company-1": ["ADMIN"] },
  companies: [{ id: "company-1", organizationId: "org-1", name: "Empresa", roles: ["ADMIN"] }],
};

describe("AuthService", () => {
  it("normalizes email and creates a bounded authenticated session", async () => {
    const repository = new FakeAuthRepository(activeUser);
    const service = new AuthService(repository, new FakePasswordHasher());

    const grant = await service.login("  OWNER@Example.COM ", "correct-password", now);

    expect(repository.lookedUpEmail).toBe("owner@example.com");
    expect(grant.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(repository.created?.refreshTokenHash).toBe(hashToken(grant.refreshToken));
    expect(repository.created?.idleExpiresAt.toISOString()).toBe("2026-08-13T20:00:00.000Z");
    expect(repository.created?.absoluteExpiresAt.toISOString()).toBe("2026-08-14T12:00:00.000Z");
    expect(grant.user.companyRoles).toEqual({ "company-1": ["ADMIN"] });
  });

  it("returns the same public failure for unknown email and wrong password", async () => {
    const unknownHasher = new FakePasswordHasher();
    const wrongHasher = new FakePasswordHasher();
    const unknownService = new AuthService(new FakeAuthRepository(null), unknownHasher);
    const wrongService = new AuthService(new FakeAuthRepository(activeUser), wrongHasher);

    const unknown = await captureAuthError(() => unknownService.login("missing@example.com", "wrong-password", now));
    const wrong = await captureAuthError(() => wrongService.login(activeUser.email, "wrong-password", now));

    expect(unknown).toEqual({ code: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos" });
    expect(wrong).toEqual(unknown);
    expect(unknownHasher.unknownVerifications).toBe(1);
  });

  it("rejects disabled users after password verification", async () => {
    const disabled = { ...activeUser, status: "DISABLED" as const };
    const error = await captureAuthError(() => new AuthService(
      new FakeAuthRepository(disabled),
      new FakePasswordHasher(),
    ).login(disabled.email, "correct-password", now));

    expect(error.code).toBe("USER_DISABLED");
  });

  it("rotates a refresh token and surfaces replay revocation", async () => {
    const repository = new FakeAuthRepository(activeUser);
    const service = new AuthService(repository, new FakePasswordHasher());
    repository.rotation = { status: "ROTATED", session: session(), user: principal };

    const grant = await service.refresh("current-refresh", now);

    expect(repository.rotated?.currentTokenHash).toBe(hashToken("current-refresh"));
    expect(repository.rotated?.replacementTokenHash).toBe(hashToken(grant.refreshToken));
    repository.rotation = { status: "REUSED" };
    await expect(service.refresh("current-refresh", now)).rejects.toMatchObject({ code: "SESSION_REVOKED" });
  });

  it("revokes sessions on logout and password change", async () => {
    const repository = new FakeAuthRepository(activeUser);
    const service = new AuthService(repository, new FakePasswordHasher());

    await service.logout("session-1", now);
    await service.changePassword(activeUser.id, "correct-password", "new-password-123", now);

    expect(repository.revoked).toEqual({ sessionId: "session-1", reason: "LOGOUT" });
    expect(repository.passwordChange).toEqual({ userId: activeUser.id, passwordHash: "hash:new-password-123" });
  });

  it("enforces password bounds and rejects password reuse", async () => {
    const service = new AuthService(new FakeAuthRepository(activeUser), new FakePasswordHasher());

    await expect(service.changePassword(activeUser.id, "correct-password", "short", now))
      .rejects.toMatchObject({ code: "INVALID_PASSWORD" });
    await expect(service.changePassword(activeUser.id, "correct-password", "correct-password", now))
      .rejects.toMatchObject({ code: "INVALID_PASSWORD" });
  });

  it("normalizes email deterministically", () => {
    expect(normalizeEmail(" User+Tag@Example.COM ")).toBe("user+tag@example.com");
  });

  it("hashes passwords with Argon2id and verifies only the original password", async () => {
    const hasher = new Argon2PasswordHasher();
    const passwordHash = await hasher.hash("correct-password");

    expect(passwordHash).toMatch(/^\$argon2id\$/);
    await expect(hasher.verify(passwordHash, "correct-password")).resolves.toBe(true);
    await expect(hasher.verify(passwordHash, "wrong-password")).resolves.toBe(false);
  });
});

class FakePasswordHasher implements PasswordHasher {
  unknownVerifications = 0;

  async hash(password: string): Promise<string> {
    return `hash:${password}`;
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    return passwordHash === `hash:${password}`;
  }

  async verifyUnknown(_password: string): Promise<void> {
    this.unknownVerifications += 1;
  }
}

class FakeAuthRepository implements AuthRepository {
  lookedUpEmail?: string;
  created?: Parameters<AuthRepository["createSession"]>[0];
  rotated?: Parameters<AuthRepository["rotateRefreshToken"]>[0];
  rotation: RefreshRotationResult = { status: "INVALID" };
  revoked?: { sessionId: string; reason: string };
  passwordChange?: { userId: string; passwordHash: string };

  constructor(private readonly user: AuthUser | null) {}

  async findUserByEmail(email: string): Promise<AuthUser | null> {
    this.lookedUpEmail = email;
    return this.user;
  }

  async findUserById(_userId: string): Promise<AuthUser | null> {
    return this.user;
  }

  async createSession(input: Parameters<AuthRepository["createSession"]>[0]) {
    this.created = input;
    return { session: session(input), user: principal };
  }

  async rotateRefreshToken(input: Parameters<AuthRepository["rotateRefreshToken"]>[0]) {
    this.rotated = input;
    return this.rotation;
  }

  async resolveSession() {
    return principal;
  }

  async revokeSession(sessionId: string, _now: Date, reason: string): Promise<void> {
    this.revoked = { sessionId, reason };
  }

  async changePasswordAndRevokeSessions(userId: string, passwordHash: string): Promise<void> {
    this.passwordChange = { userId, passwordHash };
  }
}

function session(input?: Partial<AuthSessionRecord>): AuthSessionRecord {
  return {
    id: "session-1",
    userId: activeUser.id,
    authVersion: 1,
    createdAt: now,
    lastSeenAt: now,
    idleExpiresAt: new Date("2026-08-13T20:00:00.000Z"),
    absoluteExpiresAt: new Date("2026-08-14T12:00:00.000Z"),
    revokedAt: null,
    ...input,
  };
}

async function captureAuthError(action: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await action();
    throw new Error("Expected AuthError");
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    return { code: error.code, message: error.message };
  }
}
