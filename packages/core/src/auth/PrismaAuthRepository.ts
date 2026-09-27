import { Prisma, type PrismaClient } from "@prisma/client";
import type { CompanyRole } from "../shared/domain/Authorization.js";
import type { AuthRepository } from "./AuthRepository.js";
import type {
  AuthenticatedUser,
  AuthSessionRecord,
  AuthUser,
  RefreshRotationResult,
} from "./AuthModels.js";

type AuthDbClient = PrismaClient | Prisma.TransactionClient;

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findUserByEmail(email: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    return user ? mapUser(user) : null;
  }

  async findUserById(userId: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return user ? mapUser(user) : null;
  }

  async createSession(input: {
    userId: string;
    authVersion: number;
    now: Date;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
    refreshTokenHash: string;
  }): Promise<{ session: AuthSessionRecord; user: AuthenticatedUser }> {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.authSession.create({
        data: {
          userId: input.userId,
          authVersion: input.authVersion,
          createdAt: input.now,
          lastSeenAt: input.now,
          idleExpiresAt: input.idleExpiresAt,
          absoluteExpiresAt: input.absoluteExpiresAt,
          refreshTokens: {
            create: { tokenHash: input.refreshTokenHash, expiresAt: input.absoluteExpiresAt, createdAt: input.now },
          },
        },
      });
      return { session: mapSession(session), user: await loadPrincipal(tx, input.userId) };
    });
  }

  async rotateRefreshToken(input: {
    currentTokenHash: string;
    replacementTokenHash: string;
    now: Date;
    idleExpiresAt: Date;
  }): Promise<RefreshRotationResult> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await rotateRefreshTokenOnce(this.prisma, input);
      } catch (error) {
        if (attempt >= 4 || !isPrismaError(error, "P2034")) throw error;
      }
    }
  }

  async resolveSession(input: {
    sessionId: string;
    userId: string;
    now: Date;
    touch: boolean;
  }): Promise<AuthenticatedUser | null> {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.authSession.findUnique({ where: { id: input.sessionId }, include: { user: true } });
      if (!session || session.userId !== input.userId || session.revokedAt || session.user.status !== "ACTIVE"
        || session.authVersion !== session.user.authVersion || session.idleExpiresAt <= input.now
        || session.absoluteExpiresAt <= input.now) return null;
      if (input.touch) {
        const nextIdle = minDate(new Date(input.now.getTime() + 8 * 60 * 60 * 1000), session.absoluteExpiresAt);
        await tx.authSession.update({ where: { id: session.id }, data: { lastSeenAt: input.now, idleExpiresAt: nextIdle } });
      }
      return loadPrincipal(tx, input.userId);
    });
  }

  async revokeSession(sessionId: string, now: Date, reason: string): Promise<void> {
    await this.prisma.$transaction((tx) => revokeFamily(tx, sessionId, now, reason));
  }

  async changePasswordAndRevokeSessions(userId: string, passwordHash: string, now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, passwordChangeRequired: false, authVersion: { increment: 1 } },
      });
      const sessions = await tx.authSession.findMany({ where: { userId, revokedAt: null }, select: { id: true } });
      for (const session of sessions) await revokeFamily(tx, session.id, now, "PASSWORD_CHANGED");
    });
  }
}

async function rotateRefreshTokenOnce(
  prisma: PrismaClient,
  input: Parameters<AuthRepository["rotateRefreshToken"]>[0],
): Promise<RefreshRotationResult> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.authRefreshToken.findUnique({
      where: { tokenHash: input.currentTokenHash },
      include: { session: { include: { user: true } } },
    });
    if (!current) return { status: "INVALID" };
    if (current.consumedAt || current.revokedAt) {
      await revokeFamily(tx, current.sessionId, input.now, "REFRESH_REUSE");
      return { status: "REUSED" };
    }
    const session = current.session;
    if (session.revokedAt || session.user.status !== "ACTIVE" || session.authVersion !== session.user.authVersion
      || current.expiresAt <= input.now || session.idleExpiresAt <= input.now || session.absoluteExpiresAt <= input.now) {
      await revokeFamily(tx, session.id, input.now, "SESSION_EXPIRED");
      return { status: "INVALID" };
    }

    const replacement = await tx.authRefreshToken.create({
      data: {
        sessionId: session.id,
        tokenHash: input.replacementTokenHash,
        expiresAt: session.absoluteExpiresAt,
        createdAt: input.now,
      },
    });
    const consumed = await tx.authRefreshToken.updateMany({
      where: { id: current.id, consumedAt: null, revokedAt: null },
      data: { consumedAt: input.now, replacedByTokenId: replacement.id },
    });
    if (consumed.count !== 1) {
      await revokeFamily(tx, session.id, input.now, "REFRESH_REUSE");
      return { status: "REUSED" };
    }
    const updatedSession = await tx.authSession.update({
      where: { id: session.id },
      data: {
        lastSeenAt: input.now,
        idleExpiresAt: minDate(input.idleExpiresAt, session.absoluteExpiresAt),
      },
    });
    return { status: "ROTATED", session: mapSession(updatedSession), user: await loadPrincipal(tx, session.userId) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function loadPrincipal(prisma: AuthDbClient, userId: string): Promise<AuthenticatedUser> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      organizationMemberships: { where: { role: "OWNER" }, select: { organizationId: true } },
      companyAccesses: {
        where: { company: { status: "ACTIVE" } },
        select: {
          companyId: true,
          roles: true,
          company: { select: { organizationId: true, name: true } },
        },
      },
    },
  });

  const ownerOrgIds = user.organizationMemberships.map((membership) => membership.organizationId);

  // Se o usuário for OWNER de alguma organização, auto-provisionar empresa padrão caso nenhuma exista
  for (const orgId of ownerOrgIds) {
    const companyCount = await prisma.company.count({ where: { organizationId: orgId, status: "ACTIVE" } });
    if (companyCount === 0) {
      const legalEntityId = `entity-${orgId}`;
      const existingEntity = await prisma.configLegalEntity.findUnique({
        where: { organizationId_id: { organizationId: orgId, id: legalEntityId } },
      });
      const now = new Date();
      if (!existingEntity) {
        await prisma.configLegalEntity.create({
          data: {
            organizationId: orgId,
            id: legalEntityId,
            legalName: "Empresa Matriz Principal",
            taxId: "00000000000191",
            status: "ACTIVE",
            createdAt: now,
            updatedAt: now,
          },
        });
      }
      await prisma.company.create({
        data: {
          organizationId: orgId,
          legalEntityId,
          name: "Empresa Matriz",
          documentNumber: "00.000.000/0001-91",
          status: "ACTIVE",
          timezone: "America/Sao_Paulo",
          defaultCurrency: "BRL",
        },
      });
    }
  }

  // Buscar todas as empresas ativas das organizações onde o usuário é OWNER
  const ownerCompanies = ownerOrgIds.length > 0
    ? await prisma.company.findMany({
        where: { organizationId: { in: ownerOrgIds }, status: "ACTIVE" },
        select: { id: true, organizationId: true, name: true },
      })
    : [];

  const explicitMap = new Map<string, { organizationId: string; name: string; roles: CompanyRole[] }>();
  for (const access of user.companyAccesses) {
    explicitMap.set(access.companyId, {
      organizationId: access.company.organizationId,
      name: access.company.name,
      roles: access.roles as CompanyRole[],
    });
  }

  // Se o usuário for OWNER da organização, conceder papéis totais nas empresas daquela organização
  for (const company of ownerCompanies) {
    const existing = explicitMap.get(company.id);
    if (existing) {
      const combinedRoles = Array.from(new Set([...existing.roles, "ADMIN", "PREPARER", "REVIEWER", "AUDITOR"] as CompanyRole[]));
      explicitMap.set(company.id, { ...existing, roles: combinedRoles });
    } else {
      explicitMap.set(company.id, {
        organizationId: company.organizationId,
        name: company.name,
        roles: ["ADMIN", "PREPARER", "REVIEWER", "AUDITOR"],
      });
    }
  }

  const companiesList = Array.from(explicitMap.entries()).map(([id, data]) => ({
    id,
    organizationId: data.organizationId,
    name: data.name,
    roles: data.roles,
  }));

  const companyRolesRecord = Object.fromEntries(
    companiesList.map((c) => [c.id, c.roles]),
  );

  return {
    id: user.id,
    email: user.email,
    passwordChangeRequired: user.passwordChangeRequired,
    ownerOrganizationIds: ownerOrgIds,
    companyRoles: companyRolesRecord,
    companies: companiesList,
  };
}

async function revokeFamily(prisma: AuthDbClient, sessionId: string, now: Date, reason: string): Promise<void> {
  await prisma.authSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now, revocationReason: reason },
  });
  await prisma.authRefreshToken.updateMany({
    where: { sessionId, revokedAt: null },
    data: { revokedAt: now },
  });
}

function mapUser(user: {
  id: string;
  email: string;
  passwordHash: string;
  status: "ACTIVE" | "DISABLED";
  passwordChangeRequired: boolean;
  authVersion: number;
}): AuthUser {
  return user;
}

function mapSession(session: {
  id: string;
  userId: string;
  authVersion: number;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}): AuthSessionRecord {
  return session;
}

function minDate(left: Date, right: Date): Date {
  return left <= right ? left : right;
}

function isPrismaError(error: unknown, code: string): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
