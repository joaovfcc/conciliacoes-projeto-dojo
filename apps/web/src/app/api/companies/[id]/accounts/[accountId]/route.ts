import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@conciliacao/core";
import { authService } from "@/lib/auth-runtime";
import { verifyAccessToken } from "@/lib/auth-jwt";
import { deleteLocalAccount } from "@/lib/local-store";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string; accountId: string }> }) {
  try {
    const { id: companyId, accountId } = await context.params;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    if (process.env.LOCAL_MODE === "true" || !process.env.DATABASE_URL) {
      deleteLocalAccount(accountId, (type as "BANK" | "LEDGER" | "MAPPING") || "MAPPING", companyId);
      return NextResponse.json({ success: true });
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

    const hasAdminAccess = currentUser.ownerOrganizationIds.length > 0 || currentUser.companyRoles[companyId]?.includes("ADMIN");
    if (!hasAdminAccess) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Apenas administradores podem remover contas" } }, { status: 403 });
    }

    if (type === "MAPPING") {
      const deleted = await prisma.bankLedgerMapping.deleteMany({ where: { id: accountId, companyId } });
      if (deleted.count === 0) {
        return NextResponse.json({ error: { code: "NOT_FOUND", message: "Vínculo de contas não encontrado" } }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    }

    if (type === "BANK") {
      const mappingCount = await prisma.bankLedgerMapping.count({ where: { companyId, bankAccountId: accountId } });
      if (mappingCount > 0) {
        return NextResponse.json({ error: { code: "ACCOUNT_MAPPING_EXISTS", message: "Remova primeiro os vínculos desta conta bancária." } }, { status: 409 });
      }
      const deleted = await prisma.bankAccount.deleteMany({ where: { id: accountId, companyId } });
      if (deleted.count === 0) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Conta bancária não encontrada" } }, { status: 404 });
      return NextResponse.json({ success: true });
    }

    if (type === "LEDGER") {
      const mappingCount = await prisma.bankLedgerMapping.count({ where: { companyId, ledgerAccountId: accountId } });
      if (mappingCount > 0) {
        return NextResponse.json({ error: { code: "ACCOUNT_MAPPING_EXISTS", message: "Remova primeiro os vínculos desta conta contábil." } }, { status: 409 });
      }
      const deleted = await prisma.ledgerAccount.deleteMany({ where: { id: accountId, companyId } });
      if (deleted.count === 0) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Conta contábil não encontrada" } }, { status: 404 });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: { code: "INVALID_TYPE", message: "Tipo de conta inválido" } }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao remover conta";
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 500 });
  }
}
