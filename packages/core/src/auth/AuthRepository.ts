import type {
  AuthenticatedUser,
  AuthSessionRecord,
  AuthUser,
  RefreshRotationResult,
} from "./AuthModels.js";

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUser | null>;
  findUserById(userId: string): Promise<AuthUser | null>;
  createSession(input: {
    userId: string;
    authVersion: number;
    now: Date;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
    refreshTokenHash: string;
  }): Promise<{ session: AuthSessionRecord; user: AuthenticatedUser }>;
  rotateRefreshToken(input: {
    currentTokenHash: string;
    replacementTokenHash: string;
    now: Date;
    idleExpiresAt: Date;
  }): Promise<RefreshRotationResult>;
  resolveSession(input: { sessionId: string; userId: string; now: Date; touch: boolean }): Promise<AuthenticatedUser | null>;
  revokeSession(sessionId: string, now: Date, reason: string): Promise<void>;
  changePasswordAndRevokeSessions(userId: string, passwordHash: string, now: Date): Promise<void>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
  verifyUnknown(password: string): Promise<void>;
}
