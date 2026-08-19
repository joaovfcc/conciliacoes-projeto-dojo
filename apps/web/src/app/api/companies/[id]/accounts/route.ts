import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@conciliacao/core";
import { authService } from "@/lib/auth-runtime";
import { verifyAccessToken } from "@/lib/auth-jwt";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: companyId } = await context.params;
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

    const hasAccess = currentUser.ownerOrganizationIds.length > 0 || currentUser.companies.some((c) => c.id === companyId);
    if (!hasAccess) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Acesso negado para esta empresa" } }, { status: 403 });
    }

    const [bankAccounts, ledgerAccounts] = await Promise.all([
      prisma.bankAccount.findMany({
        where: { companyId },
        orderBy: { createdAt: "asc" },
      }),
      prisma.ledgerAccount.findMany({
        where: { companyId },
        orderBy: { code: "asc" },
      }),
    ]);

    return NextResponse.json({
      bankAccounts,
      ledgerAccounts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao listar contas";
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: companyId } = await context.params;
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
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Apenas administradores podem cadastrar contas" } }, { status: 403 });
    }

    const body = (await request.json()) as {
      kind?: "LEDGER" | "BANK" | "MAPPING";
      // Ledger
      ledgerCode?: string;
      description?: string;
      sourceSystem?: string;
      // Bank
      bankCode?: string;
      bankName?: string;
      agency?: string;
      accountNumber?: string;
      accountDigit?: string;
      accountType?: "CHECKING" | "SAVINGS" | "INVESTMENT" | "OTHER";
    };

    if (body.kind === "LEDGER") {
      const code = body.ledgerCode?.trim();
      if (!code) {
        return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Código contábil é obrigatório" } }, { status: 400 });
      }

      const ledgerAccount = await prisma.ledgerAccount.upsert({
        where: { companyId_code: { companyId, code } },
        create: {
          companyId,
          code,
          description: body.description?.trim() || `Conta ${code}`,
          sourceSystem: body.sourceSystem?.trim() || "PROTHEUS",
          status: "ACTIVE",
        },
        update: {
          description: body.description?.trim() || `Conta ${code}`,
          sourceSystem: body.sourceSystem?.trim() || "PROTHEUS",
          status: "ACTIVE",
        },
      });

      return NextResponse.json({ ledgerAccount }, { status: 201 });
    }

    if (body.kind === "BANK") {
      const bankAccount = await prisma.bankAccount.create({
        data: {
          companyId,
          bankCode: body.bankCode?.trim() || null,
          bankName: body.bankName?.trim() || null,
          agency: body.agency?.trim() || null,
          accountNumber: body.accountNumber?.trim() || null,
          accountDigit: body.accountDigit?.trim() || null,
          accountType: body.accountType || "CHECKING",
          currency: "BRL",
          status: "ACTIVE",
        },
      });

      return NextResponse.json({ bankAccount }, { status: 201 });
    }

    if (body.kind === "MAPPING") {
      const code = body.ledgerCode?.trim();
      if (!code) {
        return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Código contábil é obrigatório" } }, { status: 400 });
      }

      const result = await prisma.$transaction(async (tx) => {
        const ledgerAccount = await tx.ledgerAccount.upsert({
          where: { companyId_code: { companyId, code } },
          create: {
            companyId,
            code,
            description: body.description?.trim() || `${body.bankName ?? "Banco"} Ag. ${body.agency ?? ""} C/C ${body.accountNumber ?? ""}`,
            sourceSystem: body.sourceSystem?.trim() || "PROTHEUS",
            status: "ACTIVE",
          },
          update: {
            description: body.description?.trim() || `${body.bankName ?? "Banco"} Ag. ${body.agency ?? ""} C/C ${body.accountNumber ?? ""}`,
            sourceSystem: body.sourceSystem?.trim() || "PROTHEUS",
            status: "ACTIVE",
          },
        });

        const bankAccount = await tx.bankAccount.create({
          data: {
            companyId,
            bankCode: body.bankCode?.trim() || null,
            bankName: body.bankName?.trim() || null,
            agency: body.agency?.trim() || null,
            accountNumber: body.accountNumber?.trim() || null,
            accountDigit: body.accountDigit?.trim() || null,
            accountType: body.accountType || "CHECKING",
            currency: "BRL",
            status: "ACTIVE",
          },
        });

        return { ledgerAccount, bankAccount };
      });

      return NextResponse.json(result, { status: 201 });
    }

    return NextResponse.json({ error: { code: "INVALID_KIND", message: "Tipo de conta inválido" } }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao cadastrar conta";
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 500 });
  }
}
