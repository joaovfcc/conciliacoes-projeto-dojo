import { NextResponse, type NextRequest } from "next/server";
import { Argon2PasswordHasher, assertPasswordPolicy, prisma } from "@conciliacao/core";
import { authService } from "@/lib/auth-runtime";
import { verifyAccessToken } from "@/lib/auth-jwt";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: targetUserId } = await context.params;
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

    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Usuário não encontrado" } }, { status: 404 });
    }

    const body = (await request.json()) as {
      status?: "ACTIVE" | "DISABLED";
      password?: string;
      roles?: Array<"ADMIN" | "PREPARER" | "REVIEWER" | "AUDITOR">;
      companyIds?: string[];
      isOwner?: boolean;
    };

    if (targetUserId === currentUser.id && body.status === "DISABLED") {
      return NextResponse.json({ error: { code: "INVALID_OPERATION", message: "Você não pode desativar seu próprio usuário administrador" } }, { status: 400 });
    }

    const organizationId = currentUser.ownerOrganizationIds[0]!;
    let newPasswordHash: string | undefined;
    if (body.password) {
      assertPasswordPolicy(body.password);
      const hasher = new Argon2PasswordHasher();
      newPasswordHash = await hasher.hash(body.password);
    }

    await prisma.$transaction(async (tx) => {
      const updateData: Record<string, unknown> = {};
      if (body.status) updateData.status = body.status;
      if (newPasswordHash) {
        updateData.passwordHash = newPasswordHash;
        updateData.authVersion = { increment: 1 };
      }
      if (Object.keys(updateData).length > 0) {
        await tx.user.update({
          where: { id: targetUserId },
          data: updateData,
        });
      }

      if (body.isOwner !== undefined) {
        if (body.isOwner) {
          const existingOwner = await tx.organizationMembership.findUnique({
            where: { organizationId_userId: { organizationId, userId: targetUserId } },
          });
          if (!existingOwner) {
            await tx.organizationMembership.create({
              data: { organizationId, userId: targetUserId, role: "OWNER" },
            });
          }
        } else if (targetUserId !== currentUser.id) {
          await tx.organizationMembership.deleteMany({
            where: { organizationId, userId: targetUserId },
          });
        }
      }

      if (body.companyIds !== undefined || body.roles !== undefined) {
        const companyIds = body.companyIds ?? [];
        const roles = body.roles && body.roles.length > 0 ? body.roles : ["PREPARER", "REVIEWER"];

        await tx.companyAccess.deleteMany({
          where: { userId: targetUserId },
        });

        for (const companyId of companyIds) {
          await tx.companyAccess.create({
            data: {
              companyId,
              userId: targetUserId,
              roles: roles as any,
            },
          });
        }
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao atualizar usuário";
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: targetUserId } = await context.params;
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
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Apenas administradores podem excluir usuários" } }, { status: 403 });
    }

    if (targetUserId === currentUser.id) {
      return NextResponse.json({ error: { code: "INVALID_OPERATION", message: "Você não pode excluir seu próprio usuário administrador" } }, { status: 400 });
    }

    await prisma.user.delete({
      where: { id: targetUserId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao excluir usuário";
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 500 });
  }
}
