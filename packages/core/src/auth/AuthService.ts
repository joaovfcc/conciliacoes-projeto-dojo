import { createHash, randomBytes } from "node:crypto";
import type { AuthRepository, PasswordHasher } from "./AuthRepository.js";
import {
  assertPasswordPolicy,
  AuthError,
  type AuthSessionGrant,
  type AuthenticatedUser,
  normalizeEmail,
} from "./AuthModels.js";

export interface AuthServiceOptions {
  idleTtlMs?: number;
  absoluteTtlMs?: number;
}

export class AuthService {
  private readonly idleTtlMs: number;
  private readonly absoluteTtlMs: number;

  constructor(
    private readonly repository: AuthRepository,
    private readonly passwordHasher: PasswordHasher,
    options: AuthServiceOptions = {},
  ) {
    this.idleTtlMs = options.idleTtlMs ?? 8 * 60 * 60 * 1000;
    this.absoluteTtlMs = options.absoluteTtlMs ?? 24 * 60 * 60 * 1000;
  }

  async login(email: string, password: string, now = new Date()): Promise<AuthSessionGrant> {
    const user = await this.repository.findUserByEmail(normalizeEmail(email));
    if (!user) {
      await this.passwordHasher.verifyUnknown(password);
      throw invalidCredentials();
    }
    const validPassword = await this.passwordHasher.verify(user.passwordHash, password);
    if (!validPassword) throw invalidCredentials();
    if (user.status !== "ACTIVE") throw new AuthError("USER_DISABLED", "Usuário desabilitado");

    const refreshToken = newRefreshToken();
    const absoluteExpiresAt = new Date(now.getTime() + this.absoluteTtlMs);
    const created = await this.repository.createSession({
      userId: user.id,
      authVersion: user.authVersion,
      now,
      idleExpiresAt: new Date(now.getTime() + this.idleTtlMs),
      absoluteExpiresAt,
      refreshTokenHash: hashToken(refreshToken),
    });
    return {
      sessionId: created.session.id,
      refreshToken,
      refreshExpiresAt: absoluteExpiresAt,
      user: created.user,
    };
  }

  async refresh(refreshToken: string, now = new Date()): Promise<AuthSessionGrant> {
    const replacement = newRefreshToken();
    const rotated = await this.repository.rotateRefreshToken({
      currentTokenHash: hashToken(refreshToken),
      replacementTokenHash: hashToken(replacement),
      now,
      idleExpiresAt: new Date(now.getTime() + this.idleTtlMs),
    });
    if (rotated.status !== "ROTATED") {
      if (rotated.status === "REUSED") throw new AuthError("SESSION_REVOKED", "Sessão revogada");
      throw new AuthError("SESSION_INVALID", "Sessão inválida ou expirada");
    }
    return {
      sessionId: rotated.session.id,
      refreshToken: replacement,
      refreshExpiresAt: rotated.session.absoluteExpiresAt,
      user: rotated.user,
    };
  }

  resolveSession(sessionId: string, userId: string, now = new Date()): Promise<AuthenticatedUser | null> {
    return this.repository.resolveSession({ sessionId, userId, now, touch: true });
  }

  logout(sessionId: string, now = new Date()): Promise<void> {
    return this.repository.revokeSession(sessionId, now, "LOGOUT");
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string, now = new Date()): Promise<void> {
    assertPasswordPolicy(newPassword);
    const user = await this.repository.findUserById(userId);
    if (!user || user.status !== "ACTIVE" || !await this.passwordHasher.verify(user.passwordHash, currentPassword)) {
      throw invalidCredentials();
    }
    if (await this.passwordHasher.verify(user.passwordHash, newPassword)) {
      throw new AuthError("INVALID_PASSWORD", "A nova senha deve ser diferente da senha atual");
    }
    await this.repository.changePasswordAndRevokeSessions(user.id, await this.passwordHasher.hash(newPassword), now);
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

function invalidCredentials(): AuthError {
  return new AuthError("INVALID_CREDENTIALS", "E-mail ou senha inválidos");
}
