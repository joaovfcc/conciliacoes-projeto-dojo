import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@conciliacao/core";
import { authService } from "@/lib/auth-runtime";
import { verifyAccessToken } from "@/lib/auth-jwt";
import { deleteLocalCompany, getLocalDb } from "@/lib/local-store";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: companyId } = await context.params;

    if (process.env.LOCAL_MODE === "true" || !process.env.DATABASE_URL) {
      const body = (await request.json()) as { name?: string; documentNumber?: string };
      const db = getLocalDb();
      if (body.name?.trim()) {
        db.prepare("UPDATE companies SET name = ? WHERE id = ?").run(body.name.trim(), companyId);
      }
      return NextResponse.json({ company: { id: companyId, name: body.name } });
    }
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
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Apenas administradores podem gerenciar empresas" } }, { status: 403 });
    }

    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Empresa não encontrada" } }, { status: 404 });
    }

    const body = (await request.json()) as {
      name?: string;
      documentNumber?: string;
      timezone?: string;
      defaultCurrency?: string;
      status?: "ACTIVE" | "INACTIVE";
    };

    const updateData: Record<string, unknown> = {};
    if (body.name?.trim()) updateData.name = body.name.trim();
    if (body.documentNumber !== undefined) updateData.documentNumber = body.documentNumber?.trim() || null;
    if (body.timezone) updateData.timezone = body.timezone;
    if (body.defaultCurrency) updateData.defaultCurrency = body.defaultCurrency;
    if (body.status) updateData.status = body.status;

    const updated = await prisma.company.update({
      where: { id: companyId },
      data: updateData,
    });

    return NextResponse.json({ company: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao atualizar empresa";
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: companyId } = await context.params;

    if (process.env.LOCAL_MODE === "true" || !process.env.DATABASE_URL) {
      deleteLocalCompany(companyId);
      return NextResponse.json({ success: true, mode: "DEACTIVATED" });
    }

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
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Apenas administradores podem excluir empresas" } }, { status: 403 });
    }

    // Check if company has completed reconciliations
    const count = await prisma.completedReconciliation.count({ where: { companyId } });
    if (count > 0) {
      // Soft-delete (deactivate) to preserve audit trail
      await prisma.company.update({
        where: { id: companyId },
        data: { status: "INACTIVE" },
      });
      return NextResponse.json({ success: true, mode: "DEACTIVATED" });
    }

    // Hard delete
    await prisma.$transaction(async (tx) => {
      await tx.companyAccess.deleteMany({ where: { companyId } });
      await tx.bankAccount.deleteMany({ where: { companyId } });
      await tx.ledgerAccount.deleteMany({ where: { companyId } });
      await tx.company.delete({ where: { id: companyId } });
    });

    return NextResponse.json({ success: true, mode: "DELETED" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao excluir empresa";
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 500 });
  }
}
