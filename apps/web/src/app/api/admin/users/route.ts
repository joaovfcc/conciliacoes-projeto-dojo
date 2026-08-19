import { NextResponse, type NextRequest } from "next/server";
import { Argon2PasswordHasher, assertPasswordPolicy, normalizeEmail, prisma } from "@conciliacao/core";
import { authService } from "@/lib/auth-runtime";
import { verifyAccessToken } from "@/lib/auth-jwt";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Token não informado" } }, { status: 401 });
    }
    const token = authHeader.slice(7);
    const claims = await verifyAccessToken(token);
    const currentUser = await authService().resolveSession(claims.sessionId, claims.userId);
    if (!currentUser) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Sessão inválida ou expirada" } }, { status: 401 });
    }

    if (currentUser.ownerOrganizationIds.length === 0) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Apenas administradores podem gerenciar usuários" } }, { status: 403 });
    }

    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        status: true,
        passwordChangeRequired: true,
        createdAt: true,
        updatedAt: true,
        organizationMemberships: {
          select: {
            organizationId: true,
            role: true,
          },
        },
        companyAccesses: {
          select: {
            id: true,
            companyId: true,
            roles: true,
            company: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const formattedUsers = users.map((u) => ({
      id: u.id,
      email: u.email,
      status: u.status,
      isOwner: u.organizationMemberships.length > 0,
      passwordChangeRequired: u.passwordChangeRequired,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
      companyAccesses: u.companyAccesses.map((ca) => ({
        companyId: ca.companyId,
        companyName: ca.company.name,
        roles: ca.roles,
      })),
    }));

    return NextResponse.json({ users: formattedUsers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao listar usuários";
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Token não informado" } }, { status: 401 });
    }
    const token = authHeader.slice(7);
    const claims = await verifyAccessToken(token);
    const currentUser = await authService().resolveSession(claims.sessionId, claims.userId);
    if (!currentUser) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Sessão inválida ou expirada" } }, { status: 401 });
    }

    if (currentUser.ownerOrganizationIds.length === 0) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Apenas administradores podem criar usuários" } }, { status: 403 });
    }

    const body = (await request.json()) as {
      email?: string;
      password?: string;
      roles?: Array<"ADMIN" | "PREPARER" | "REVIEWER" | "AUDITOR">;
      companyIds?: string[];
      isOwner?: boolean;
    };

    const rawEmail = body.email?.trim();
    if (!rawEmail || !rawEmail.includes("@")) {
      return NextResponse.json({ error: { code: "INVALID_INPUT", message: "E-mail inválido" } }, { status: 400 });
    }
    const email = normalizeEmail(rawEmail);

    const password = body.password ?? "";
    try {
      assertPasswordPolicy(password);
    } catch (policyError) {
      const message = policyError instanceof Error ? policyError.message : "A senha não atende aos requisitos de segurança";
      return NextResponse.json({ error: { code: "WEAK_PASSWORD", message } }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: { code: "EMAIL_EXISTS", message: "Já existe um usuário cadastrado com este e-mail" } }, { status: 409 });
    }

    const passwordHasher = new Argon2PasswordHasher();
    const passwordHash = await passwordHasher.hash(password);

    const organizationId = currentUser.ownerOrganizationIds[0]!;
    const roles = body.roles && body.roles.length > 0 ? body.roles : ["PREPARER", "REVIEWER"];
    const companyIds = Array.isArray(body.companyIds) ? body.companyIds : [];

    const createdUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          status: "ACTIVE",
          passwordChangeRequired: false,
        },
      });

      if (body.isOwner) {
        await tx.organizationMembership.create({
          data: {
            organizationId,
            userId: user.id,
            role: "OWNER",
          },
        });
      }

      for (const companyId of companyIds) {
        await tx.companyAccess.create({
          data: {
            companyId,
            userId: user.id,
            roles: roles as any,
          },
        });
      }

      return user;
    });

    return NextResponse.json(
      {
        user: {
          id: createdUser.id,
          email: createdUser.email,
          status: createdUser.status,
          isOwner: Boolean(body.isOwner),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao criar usuário";
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 500 });
  }
}
