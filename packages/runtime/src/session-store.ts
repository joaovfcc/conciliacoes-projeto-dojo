import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import Redis from "ioredis";
import type { RuntimeConfig } from "./config.js";
import type { CreateSessionResult, PublicSession, ReconciliationSession } from "./types.js";

export interface SessionStore {
  create(clientKey: string): Promise<CreateSessionResult>;
  get(id: string): Promise<ReconciliationSession | null>;
  save(session: ReconciliationSession): Promise<void>;
  delete(id: string): Promise<void>;
  authorize(id: string, token: string): Promise<ReconciliationSession | null>;
  countActive(clientKey: string): Promise<number>;
  countCreatedLastHour(clientKey: string): Promise<number>;
  markCreated(clientKey: string): Promise<void>;
  listExpired(now: Date): Promise<ReconciliationSession[]>;
}

const memory = new Map<string, ReconciliationSession>();
const createdByClient = new Map<string, number[]>();
const deletedSessions = new Set<string>();

export class MemorySessionStore implements SessionStore {
  constructor(private readonly config: RuntimeConfig) {}

  async create(clientKey: string): Promise<CreateSessionResult> {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const session: ReconciliationSession = {
      id: randomBytes(16).toString("hex"), tokenHash: hashToken(token), clientKey,
      createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + this.config.sessionTtlSeconds * 1000).toISOString(),
      lastHeartbeatAt: now.toISOString(), status: "DRAFT", progress: 0,
      progressMessage: "Sessão criada.", files: [], closed: false,
    };
    memory.set(session.id, structuredClone(session));
    await this.markCreated(clientKey);
    return { session: publicSession(session), token };
  }
  async get(id: string) { return memory.has(id) ? structuredClone(memory.get(id)!) : null; }
  async save(session: ReconciliationSession) { if (!deletedSessions.has(session.id)) memory.set(session.id, structuredClone(session)); }
  async delete(id: string) { deletedSessions.add(id); memory.delete(id); }
  async authorize(id: string, token: string) { const session = await this.get(id); return session && tokenMatches(session.tokenHash, token) ? session : null; }
  async countActive(clientKey: string) { return [...memory.values()].filter((item) => item.clientKey === clientKey && !item.closed && !["CANCELLED", "EXPIRED"].includes(item.status)).length; }
  async countCreatedLastHour(clientKey: string) { const cutoff = Date.now() - 3_600_000; return (createdByClient.get(clientKey) ?? []).filter((item) => item >= cutoff).length; }
  async markCreated(clientKey: string) { const cutoff = Date.now() - 3_600_000; createdByClient.set(clientKey, [...(createdByClient.get(clientKey) ?? []).filter((item) => item >= cutoff), Date.now()]); }
  async listExpired(now: Date): Promise<ReconciliationSession[]> { return [...memory.values()].filter((item) => new Date(item.expiresAt) <= now || now.getTime() - new Date(item.lastHeartbeatAt).getTime() > this.config.heartbeatGraceSeconds * 1000).map((item) => structuredClone(item)); }
}

export class RedisSessionStore implements SessionStore {
  private readonly redis: Redis;
  constructor(private readonly config: RuntimeConfig) {
    if (!config.redisUrl) throw new Error("REDIS_URL é obrigatório.");
    this.redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  }
  async create(clientKey: string): Promise<CreateSessionResult> {
    const token = randomBytes(32).toString("base64url"); const now = new Date();
    const session: ReconciliationSession = { id: randomBytes(16).toString("hex"), tokenHash: hashToken(token), clientKey, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + this.config.sessionTtlSeconds * 1000).toISOString(), lastHeartbeatAt: now.toISOString(), status: "DRAFT", progress: 0, progressMessage: "Sessão criada.", files: [], closed: false };
    await this.save(session); await this.markCreated(clientKey);
    return { session: publicSession(session), token };
  }
  async get(id: string) { const value = await this.redis.get(`session:${id}`); return value ? JSON.parse(value) as ReconciliationSession : null; }
  async save(session: ReconciliationSession) { if (await this.redis.exists(`session:deleted:${session.id}`)) return; const ttl = Math.max(1, Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000)); await this.redis.set(`session:${session.id}`, JSON.stringify(session), "EX", ttl); await this.redis.sadd("sessions:active", session.id); }
  async delete(id: string) { await this.redis.set(`session:deleted:${id}`, "1", "EX", this.config.sessionTtlSeconds); await this.redis.del(`session:${id}`); await this.redis.srem("sessions:active", id); }
  async authorize(id: string, token: string) { const session = await this.get(id); return session && tokenMatches(session.tokenHash, token) ? session : null; }
  async countActive(clientKey: string) { const ids = await this.redis.smembers("sessions:active"); let count = 0; for (const id of ids) { const item = await this.get(id); if (item?.clientKey === clientKey && !item.closed && !["CANCELLED", "EXPIRED"].includes(item.status)) count += 1; } return count; }
  async countCreatedLastHour(clientKey: string) { const key = `rate:create:${clientKey}`; const cutoff = Date.now() - 3_600_000; await this.redis.zremrangebyscore(key, 0, cutoff); return this.redis.zcard(key); }
  async markCreated(clientKey: string) { const key = `rate:create:${clientKey}`; await this.redis.zadd(key, Date.now(), `${Date.now()}:${randomBytes(4).toString("hex")}`); await this.redis.expire(key, 3600); }
  async listExpired(now: Date) { const ids = await this.redis.smembers("sessions:active"); const expired: ReconciliationSession[] = []; for (const id of ids) { const item = await this.get(id); if (!item) { await this.redis.srem("sessions:active", id); continue; } if (new Date(item.expiresAt) <= now || now.getTime() - new Date(item.lastHeartbeatAt).getTime() > this.config.heartbeatGraceSeconds * 1000) expired.push(item); } return expired; }
}

export function createSessionStore(config: RuntimeConfig): SessionStore {
  return config.redisUrl ? new RedisSessionStore(config) : new MemorySessionStore(config);
}

export function publicSession(session: ReconciliationSession): PublicSession {
  const { tokenHash: _tokenHash, clientKey: _clientKey, ledgers: _ledgers, statements: _statements, confirmation: _confirmation, ...safe } = session;
  return safe;
}

function hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function tokenMatches(expected: string, token: string): boolean { const actual = hashToken(token); return expected.length === actual.length && timingSafeEqual(Buffer.from(expected), Buffer.from(actual)); }
