import type { CompanyRole } from "../shared/domain/Authorization.js";

export type AuthUserStatus = "ACTIVE" | "DISABLED";

export interface AuthUser {
  id: string;
  email: string;
  passwordHash: string;
  status: AuthUserStatus;
  passwordChangeRequired: boolean;
  authVersion: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  passwordChangeRequired: boolean;
  ownerOrganizationIds: string[];
  companyRoles: Record<string, CompanyRole[]>;
  companies: Array<{
    id: string;
    organizationId: string;
    name: string;
    roles: CompanyRole[];
  }>;
}

export interface AuthSessionRecord {
  id: string;
  userId: string;
  authVersion: number;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

export interface AuthSessionGrant {
  sessionId: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: AuthenticatedUser;
}

export type RefreshRotationResult =
  | { status: "ROTATED"; session: AuthSessionRecord; user: AuthenticatedUser }
  | { status: "REUSED" | "INVALID" };

export class AuthError extends Error {
  constructor(
    readonly code:
      | "INVALID_CREDENTIALS"
      | "INVALID_PASSWORD"
      | "SESSION_INVALID"
      | "SESSION_REVOKED"
      | "USER_DISABLED",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function assertPasswordPolicy(password: string): void {
  if (password.length < 12 || password.length > 128) {
    throw new AuthError("INVALID_PASSWORD", "A senha deve ter entre 12 e 128 caracteres");
  }
}
