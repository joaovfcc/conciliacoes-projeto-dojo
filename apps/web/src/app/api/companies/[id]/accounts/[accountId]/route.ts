import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@conciliacao/core";
import { authService } from "@/lib/auth-runtime";
import { verifyAccessToken } from "@/lib/auth-jwt";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string; accountId: string }> }) {
  try {
    const { id: companyId, accountId } = await context.params;
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

    const hasAdminAccess = currentUser.ownerOrganizationIds.length > 0 || currentUser.companyRoles[companyId]?.includes("ADMIN");
    if (!hasAdminAccess) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Apenas administradores podem remover contas" } }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type"); // "BANK" or "LEDGER"

    if (type === "BANK") {
      await prisma.bankAccount.delete({
        where: { id: accountId },
      });
      return NextResponse.json({ success: true });
    }

    if (type === "LEDGER") {
      await prisma.ledgerAccount.delete({
        where: { id: accountId },
      });
      return NextResponse.json({ success: true });
    }

    // Try deleting bank account or ledger account
    try {
      await prisma.bankAccount.delete({ where: { id: accountId } });
      return NextResponse.json({ success: true });
    } catch {
      await prisma.ledgerAccount.delete({ where: { id: accountId } });
      return NextResponse.json({ success: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao remover conta";
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 500 });
  }
}
