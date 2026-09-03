import { NextResponse, type NextRequest } from "next/server";
import { normalizeBankAccountRegistration, prisma } from "@conciliacao/core";
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

    const [bankAccounts, ledgerAccounts, mappings] = await Promise.all([
      prisma.bankAccount.findMany({
        where: { companyId },
        orderBy: { createdAt: "asc" },
      }),
      prisma.ledgerAccount.findMany({
        where: { companyId },
        orderBy: { code: "asc" },
      }),
      prisma.bankLedgerMapping.findMany({
        where: { companyId },
        include: { bankAccount: true, ledgerAccount: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    return NextResponse.json({
      bankAccounts,
      ledgerAccounts,
      mappings,
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
      bankAccountId?: string;
      ledgerAccountId?: string;
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
      const normalized = normalizeRegistration(body);
      if (normalized instanceof Response) return normalized;
      const bankAccount = await prisma.bankAccount.create({
        data: {
          companyId,
          bankCode: normalized.bankCode ?? null,
          bankName: body.bankName?.trim() || null,
          agency: normalized.agency ?? null,
          accountNumber: normalized.accountNumber ?? null,
          accountDigit: normalized.accountDigit ?? null,
          accountType: body.accountType || "CHECKING",
          currency: "BRL",
          status: "ACTIVE",
        },
      });

      return NextResponse.json({ bankAccount }, { status: 201 });
    }

    if (body.kind === "MAPPING") {
      const result = await prisma.$transaction(async (tx) => {
        const existingIds = body.bankAccountId && body.ledgerAccountId
          ? await Promise.all([
            tx.bankAccount.findFirst({ where: { id: body.bankAccountId, companyId } }),
            tx.ledgerAccount.findFirst({ where: { id: body.ledgerAccountId, companyId } }),
          ])
          : undefined;

        if (existingIds && (!existingIds[0] || !existingIds[1])) {
          throw new AccountMappingInputError("A conta bancária e a conta contábil devem pertencer à empresa selecionada.");
        }

        const ledgerAccount = existingIds?.[1] ?? await upsertLedgerAccount(tx, companyId, body);
        const bankAccount = existingIds?.[0] ?? await findOrCreateBankAccount(tx, companyId, body);
        const mapping = await tx.bankLedgerMapping.upsert({
          where: { bankAccountId_ledgerAccountId: { bankAccountId: bankAccount.id, ledgerAccountId: ledgerAccount.id } },
          create: { companyId, bankAccountId: bankAccount.id, ledgerAccountId: ledgerAccount.id, status: "ACTIVE" },
          update: { status: "ACTIVE" },
          include: { bankAccount: true, ledgerAccount: true },
        });

        return { ledgerAccount, bankAccount, mapping };
      });

      return NextResponse.json(result, { status: 201 });
    }

    return NextResponse.json({ error: { code: "INVALID_KIND", message: "Tipo de conta inválido" } }, { status: 400 });
  } catch (error) {
    if (error instanceof AccountMappingInputError) {
      return NextResponse.json({ error: { code: "INVALID_ACCOUNT_MAPPING", message: error.message } }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Erro ao cadastrar conta";
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 500 });
  }
}

type AccountMappingTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function upsertLedgerAccount(
  tx: AccountMappingTransaction,
  companyId: string,
  body: { ledgerCode?: string; description?: string; sourceSystem?: string; bankName?: string; agency?: string; accountNumber?: string },
) {
  const code = body.ledgerCode?.trim().toUpperCase();
  if (!code) throw new AccountMappingInputError("Código contábil é obrigatório.");
  return tx.ledgerAccount.upsert({
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
}

async function findOrCreateBankAccount(
  tx: AccountMappingTransaction,
  companyId: string,
  body: { bankCode?: string; bankName?: string; agency?: string; accountNumber?: string; accountDigit?: string; accountType?: "CHECKING" | "SAVINGS" | "INVESTMENT" | "OTHER" },
) {
  const normalized = normalizeRegistration(body);
  if (normalized instanceof Response) throw new AccountMappingInputError("Identidade bancária inválida.");
  if (!normalized.bankCode || !normalized.agency || !normalized.accountNumber) {
    throw new AccountMappingInputError("Banco, agência e conta bancária são obrigatórios para criar um vínculo.");
  }
  const current = await tx.bankAccount.findFirst({
    where: {
      companyId,
      bankCode: normalized.bankCode,
      agency: normalized.agency,
      accountNumber: normalized.accountNumber,
      accountDigit: normalized.accountDigit ?? null,
    },
  });
  if (current) {
    return current.status === "ACTIVE" ? current : tx.bankAccount.update({ where: { id: current.id }, data: { status: "ACTIVE" } });
  }
  return tx.bankAccount.create({
    data: {
      companyId,
      bankCode: normalized.bankCode,
      bankName: body.bankName?.trim() || null,
      agency: normalized.agency,
      accountNumber: normalized.accountNumber,
      accountDigit: normalized.accountDigit ?? null,
      accountType: body.accountType || "CHECKING",
      currency: "BRL",
      status: "ACTIVE",
    },
  });
}

class AccountMappingInputError extends Error {}

function normalizeRegistration(input: {
  bankCode?: string;
  agency?: string;
  accountNumber?: string;
  accountDigit?: string;
}) {
  try {
    return normalizeBankAccountRegistration(input);
  } catch (error) {
    return NextResponse.json({
      error: {
        code: "INVALID_ACCOUNT_IDENTITY",
        message: error instanceof Error ? error.message : "Identidade bancária inválida",
      },
    }, { status: 400 });
  }
}
