import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { createV2ActorToken, requireV2Actor, verifyV2ActorToken, V2HttpError } from "../../src/lib/v2-auth";

const secret = "test-secret-with-at-least-thirty-two-characters";
const originalSecret = process.env.V2_AUTH_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.V2_AUTH_SECRET;
  else process.env.V2_AUTH_SECRET = originalSecret;
});

describe("BR-12/BR-13 — credencial V2 assinada", () => {
  it("verifica assinatura, validade e papéis por empresa", () => {
    process.env.V2_AUTH_SECRET = secret;
    const token = createV2ActorToken({
      actorId: "reviewer-1",
      companyRoles: { "company-1": ["REVIEWER"] },
      exp: Math.floor(Date.now() / 1000) + 60,
    }, secret);
    const request = new NextRequest("http://localhost/api/v2/reconciliations/run-1", {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(verifyV2ActorToken(token, secret).actorId).toBe("reviewer-1");
    expect(requireV2Actor(request, "company-1", ["REVIEWER"]).actorId).toBe("reviewer-1");
    expect(() => requireV2Actor(request, "company-2", ["REVIEWER"])).toThrowError(V2HttpError);
  });

  it("rejeita adulteração e expiração", () => {
    const active = createV2ActorToken({
      actorId: "actor-1",
      companyRoles: { "company-1": ["ADMIN"] },
      exp: Math.floor(Date.now() / 1000) + 60,
    }, secret);
    const expired = createV2ActorToken({
      actorId: "actor-1",
      companyRoles: { "company-1": ["ADMIN"] },
      exp: Math.floor(Date.now() / 1000) - 1,
    }, secret);

    const [payload, signature] = active.split(".") as [string, string];
    const tampered = `${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    expect(() => verifyV2ActorToken(tampered, secret)).toThrowError(V2HttpError);
    expect(() => verifyV2ActorToken(expired, secret)).toThrowError(V2HttpError);
  });
});
