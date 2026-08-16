// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { signAccessToken, verifyAccessToken } from "../../src/lib/auth-jwt";
import { requireV2Actor, V2HttpError } from "../../src/lib/v2-auth";

const secret = "test-secret-with-at-least-thirty-two-characters";
const originalSecret = process.env.AUTH_JWT_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.AUTH_JWT_SECRET;
  else process.env.AUTH_JWT_SECRET = originalSecret;
});

describe("BR-12/BR-13 — credencial V2 assinada", () => {
  it("verifica JWT padrão e resolve papéis atuais fora do token", async () => {
    process.env.AUTH_JWT_SECRET = secret;
    const { token } = await signAccessToken({ userId: "reviewer-1", sessionId: "session-1" });
    const request = new NextRequest("http://localhost/api/v2/reconciliations/run-1", {
      headers: { authorization: `Bearer ${token}` },
    });
    const dependencies = {
      verifyAccess: verifyAccessToken,
      resolveSession: async () => ({
        id: "reviewer-1", email: "reviewer@example.com", passwordChangeRequired: false,
        ownerOrganizationIds: [], companyRoles: { "company-1": ["REVIEWER" as const] },
        companies: [{ id: "company-1", organizationId: "org-1", name: "Empresa", roles: ["REVIEWER" as const] }],
      }),
    };

    expect(token.split(".")).toHaveLength(3);
    await expect(requireV2Actor(request, "company-1", ["REVIEWER"], dependencies))
      .resolves.toMatchObject({ actorId: "reviewer-1" });
    await expect(requireV2Actor(request, "company-2", ["REVIEWER"], dependencies)).rejects.toBeInstanceOf(V2HttpError);
  });

  it("rejeita token legado de dois segmentos", async () => {
    process.env.AUTH_JWT_SECRET = secret;
    const request = new NextRequest("http://localhost/api/v2/reconciliations", {
      headers: { authorization: "Bearer legacy-payload.legacy-signature" },
    });

    await expect(requireV2Actor(request)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("bloqueia operações V2 enquanto a senha temporária não for alterada", async () => {
    const request = new NextRequest("http://localhost/api/v2/reconciliations", {
      headers: { authorization: "Bearer valid-test-token" },
    });
    const dependencies = {
      verifyAccess: async () => ({ userId: "user-1", sessionId: "session-1" }),
      resolveSession: async () => ({
        id: "user-1", email: "owner@example.com", passwordChangeRequired: true,
        ownerOrganizationIds: ["org-1"], companyRoles: { "company-1": ["ADMIN" as const] },
        companies: [{ id: "company-1", organizationId: "org-1", name: "Empresa", roles: ["ADMIN" as const] }],
      }),
    };

    await expect(requireV2Actor(request, "company-1", ["ADMIN"], dependencies))
      .rejects.toMatchObject({ code: "PASSWORD_CHANGE_REQUIRED", status: 403 });
  });
});
