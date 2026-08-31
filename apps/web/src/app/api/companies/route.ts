import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@conciliacao/core";
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
    const user = await authService().resolveSession(claims.sessionId, claims.userId);
    if (!user) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Sessão inválida ou expirada" } }, { status: 401 });
    }

    return NextResponse.json({
      companies: user.companies,
      isOwner: user.ownerOrganizationIds.length > 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao listar empresas";
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
    const user = await authService().resolveSession(claims.sessionId, claims.userId);
    if (!user) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Sessão inválida ou expirada" } }, { status: 401 });
    }

    if (user.ownerOrganizationIds.length === 0) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Apenas administradores podem cadastrar empresas" } }, { status: 403 });
    }

    const body = await request.json() as {
      name?: string;
      documentNumber?: string;
      timezone?: string;
      defaultCurrency?: string;
    };

    const name = body.name?.trim();
    if (!name || name.length < 2) {
      return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Nome da empresa é obrigatório" } }, { status: 400 });
    }

    const organizationId = user.ownerOrganizationIds[0]!;
    const cleanDoc = (body.documentNumber ?? "").replace(/\D/g, "") || `DOC${Date.now()}`;
    const legalEntityId = `entity-${cleanDoc.toLowerCase()}`;

    const now = new Date();

    const company = await prisma.$transaction(async (tx) => {
      let legalEntity = await tx.configLegalEntity.findUnique({
        where: { organizationId_id: { organizationId, id: legalEntityId } },
      });

      if (!legalEntity) {
        legalEntity = await tx.configLegalEntity.create({
          data: {
            organizationId,
            id: legalEntityId,
            legalName: name,
            taxId: cleanDoc,
            status: "ACTIVE",
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      return tx.company.create({
        data: {
          organizationId,
          legalEntityId: legalEntity.id,
          name,
          documentNumber: body.documentNumber?.trim() || null,
          timezone: body.timezone || "America/Sao_Paulo",
          defaultCurrency: body.defaultCurrency || "BRL",
          status: "ACTIVE",
        },
      });
    });

    return NextResponse.json({
      company: {
        id: company.id,
        organizationId: company.organizationId,
        name: company.name,
        roles: ["ADMIN", "PREPARER", "REVIEWER", "AUDITOR"],
      },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao criar empresa";
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 500 });
  }
}
