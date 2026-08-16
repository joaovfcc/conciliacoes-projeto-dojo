import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

const accessClaimsSchema = z.object({
  sub: z.string().trim().min(1),
  sid: z.string().trim().min(1),
});

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
}

export async function signAccessToken(
  claims: AccessTokenClaims,
  now = new Date(),
  config = loadJwtConfig(),
): Promise<{ token: string; expiresAt: Date }> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = new Date(now.getTime() + config.ttlSeconds * 1000);
  const token = await new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.userId)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setJti(randomUUID())
    .setIssuedAt(issuedAt)
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(config.secret);
  return { token, expiresAt };
}

export async function verifyAccessToken(token: string, config = loadJwtConfig()): Promise<AccessTokenClaims> {
  const verified = await jwtVerify(token, config.secret, {
    algorithms: ["HS256"],
    issuer: config.issuer,
    audience: config.audience,
  });
  const claims = accessClaimsSchema.parse(verified.payload);
  return { userId: claims.sub, sessionId: claims.sid };
}

function loadJwtConfig(): { secret: Uint8Array; issuer: string; audience: string; ttlSeconds: number } {
  const rawSecret = process.env.AUTH_JWT_SECRET;
  if (!rawSecret || rawSecret.length < 32) throw new Error("AUTH_JWT_SECRET deve possuir ao menos 32 caracteres");
  return {
    secret: new TextEncoder().encode(rawSecret),
    issuer: process.env.AUTH_JWT_ISSUER || "conciliacao-web",
    audience: process.env.AUTH_JWT_AUDIENCE || "conciliacao-api",
    ttlSeconds: positiveInt(process.env.AUTH_ACCESS_TTL_SECONDS, 600),
  };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw ?? String(fallback), 10);
  if (!Number.isInteger(value) || value <= 0) throw new Error("Configuração de autenticação inválida");
  return value;
}
