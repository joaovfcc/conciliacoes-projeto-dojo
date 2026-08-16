import { Argon2PasswordHasher, AuthService, PrismaAuthRepository, prisma } from "@conciliacao/core";
import { RedisRateLimiter } from "@conciliacao/runtime";
import { createAuthHandlers } from "./auth-api";
import { signAccessToken, verifyAccessToken } from "./auth-jwt";

const globalAuth = globalThis as typeof globalThis & { authService?: AuthService; rateLimiter?: RedisRateLimiter };

export function authService(): AuthService {
  globalAuth.authService ??= new AuthService(
    new PrismaAuthRepository(prisma),
    new Argon2PasswordHasher(),
    {
      idleTtlMs: positiveInt(process.env.AUTH_IDLE_TTL_SECONDS, 28_800) * 1000,
      absoluteTtlMs: positiveInt(process.env.AUTH_ABSOLUTE_TTL_SECONDS, 86_400) * 1000,
    },
  );
  return globalAuth.authService;
}

export function authHandlers() {
  return createAuthHandlers({
    auth: authService(),
    signAccess: signAccessToken,
    verifyAccess: verifyAccessToken,
    rateLimiter: rateLimiter(),
  });
}

export function rateLimiter(): RedisRateLimiter {
  const redisUrl = process.env.REDIS_URL;
  const keySecret = process.env.RATE_LIMIT_KEY_SECRET;
  if (!redisUrl || !keySecret) throw new Error("REDIS_URL e RATE_LIMIT_KEY_SECRET são obrigatórios para autenticação");
  globalAuth.rateLimiter ??= new RedisRateLimiter(redisUrl, keySecret);
  return globalAuth.rateLimiter;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw ?? String(fallback), 10);
  if (!Number.isInteger(value) || value <= 0) throw new Error("Configuração de autenticação inválida");
  return value;
}
