import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import Redis from "ioredis";
import type { RuntimeConfig } from "./config.js";
import type { ConfirmProcessingRequest } from "@conciliacao/core";
import type { CreateSessionResult, PublicSession, ReconciliationSession } from "./types.js";

export interface SessionStore {
  create(clientKey: string, actorId: string, organizationId: string, companyId: string): Promise<CreateSessionResult>;
  get(id: string): Promise<ReconciliationSession | null>;
  save(session: ReconciliationSession): Promise<void>;
  delete(id: string): Promise<void>;
  authorize(id: string, token: string): Promise<ReconciliationSession | null>;
  claimConfirmation(id: string, confirmation: ConfirmProcessingRequest): Promise<"CLAIMED" | "SAME" | "CONFLICT" | "MISSING">;
  claimProcessing(id: string, attemptId: string): Promise<{ claimed: false } | { claimed: true; generation: number }>;
  markClosed(id: string, status: "CANCELLED" | "EXPIRED"): Promise<ReconciliationSession | null>;
  touchHeartbeat(id: string, at: string): Promise<boolean>;
  complete(session: ReconciliationSession): Promise<boolean>;
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

  async create(clientKey: string, actorId: string, organizationId: string, companyId: string): Promise<CreateSessionResult> {
    const activeForClient = [...memory.values()]
      .filter((item) => item.clientKey === clientKey && !item.closed && !["CANCELLED", "EXPIRED"].includes(item.status))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    if (this.config.maxSessionsPerIp > 0 && activeForClient.length >= this.config.maxSessionsPerIp) {
      const overflow = activeForClient.length - this.config.maxSessionsPerIp + 1;
      for (const oldest of activeForClient.slice(0, overflow)) {
        await this.delete(oldest.id);
      }
    }
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const session: ReconciliationSession = {
      id: randomBytes(16).toString("hex"), tokenHash: hashToken(token), clientKey, actorId, organizationId, companyId,
      createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + this.config.sessionTtlSeconds * 1000).toISOString(),
      lastHeartbeatAt: now.toISOString(), status: "DRAFT", progress: 0,
      progressMessage: "Sessão criada.", files: [], closed: false,
    };
    memory.set(session.id, structuredClone(session));
    await this.markCreated(clientKey);
    return { session: publicSession(session), token };
  }
  async get(id: string) { return memory.has(id) ? structuredClone(memory.get(id)!) : null; }
  async save(session: ReconciliationSession) {
    if (deletedSessions.has(session.id)) return;
    const current = memory.get(session.id);
    memory.set(session.id, structuredClone(current ? mergeSession(current, session) : session));
  }
  async delete(id: string) { deletedSessions.add(id); memory.delete(id); }
  async authorize(id: string, token: string) { const session = await this.get(id); return session && tokenMatches(session.tokenHash, token) ? session : null; }
  async claimConfirmation(id: string, confirmation: ConfirmProcessingRequest) {
    const session = memory.get(id);
    if (!session || deletedSessions.has(id)) return "MISSING" as const;
    const hash = hashConfirmation(confirmation);
    if (session.confirmation) {
      return session.confirmationHash === hash ? "SAME" as const : "CONFLICT" as const;
    }
    session.confirmation = structuredClone(confirmation);
    session.confirmationHash = hash;
    memory.set(id, structuredClone(session));
    return "CLAIMED" as const;
  }
  async claimProcessing(id: string, attemptId: string) { const session = memory.get(id); if (!session || deletedSessions.has(id) || session.closed || isSuccessfulTerminal(session.status)) return { claimed: false as const }; const generation = (session.processingGeneration ?? 0) + 1; session.processingAttemptId = attemptId; session.processingGeneration = generation; return { claimed: true as const, generation }; }
  async markClosed(id: string, status: "CANCELLED" | "EXPIRED") { const session = memory.get(id); if (!session || deletedSessions.has(id)) return null; session.closed = true; session.status = status; memory.set(id, structuredClone(session)); return structuredClone(session); }
  async touchHeartbeat(id: string, at: string) { const session = memory.get(id); if (!session || deletedSessions.has(id)) return false; session.lastHeartbeatAt = at; return true; }
  async complete(session: ReconciliationSession) { const current = memory.get(session.id); if (!current || deletedSessions.has(session.id) || current.closed || (session.processingAttemptId && current.processingAttemptId !== session.processingAttemptId)) return false; memory.set(session.id, structuredClone(session)); return true; }
  async countActive(clientKey: string) { return [...memory.values()].filter((item) => item.clientKey === clientKey && !item.closed && !["CANCELLED", "EXPIRED"].includes(item.status)).length; }
  async countCreatedLastHour(clientKey: string) { const cutoff = Date.now() - 3_600_000; return (createdByClient.get(clientKey) ?? []).filter((item) => item >= cutoff).length; }
  async markCreated(clientKey: string) { const cutoff = Date.now() - 3_600_000; createdByClient.set(clientKey, [...(createdByClient.get(clientKey) ?? []).filter((item) => item >= cutoff), Date.now()]); }
  async listExpired(now: Date): Promise<ReconciliationSession[]> { return [...memory.values()].filter((item) => new Date(item.expiresAt) <= now || now.getTime() - new Date(item.lastHeartbeatAt).getTime() > this.config.heartbeatGraceSeconds * 1000).map((item) => structuredClone(item)); }
}

export class RedisSessionStore implements SessionStore {
  private readonly redis: Redis;
  constructor(private readonly config: RuntimeConfig) {
    if (!config.redisUrl) throw new Error("REDIS_URL é obrigatório.");
    this.redis = new Redis(config.redisUrl, {
      connectTimeout: 5_000,
      commandTimeout: 5_000,
      maxRetriesPerRequest: 1,
    });
  }
  async create(clientKey: string, actorId: string, organizationId: string, companyId: string): Promise<CreateSessionResult> {
    const token = randomBytes(32).toString("base64url"); const now = new Date();
    const session: ReconciliationSession = { id: randomBytes(16).toString("hex"), tokenHash: hashToken(token), clientKey, actorId, organizationId, companyId, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + this.config.sessionTtlSeconds * 1000).toISOString(), lastHeartbeatAt: now.toISOString(), status: "DRAFT", progress: 0, progressMessage: "Sessão criada.", files: [], closed: false };
    await this.save(session); await this.markCreated(clientKey);
    return { session: publicSession(session), token };
  }
  async get(id: string) { const value = await this.redis.get(`session:${id}`); return value ? deserializeSession(value) : null; }
  async save(session: ReconciliationSession) {
    const ttl = Math.max(1, new Date(session.expiresAt).getTime() - Date.now());
    await this.redis.eval(
      saveSessionScript,
      2,
      `session:${session.id}`,
      `session:deleted:${session.id}`,
      JSON.stringify(session),
      ttl,
    );
  }
  async delete(id: string) { await this.redis.set(`session:deleted:${id}`, "1", "EX", this.config.sessionTtlSeconds); await this.redis.del(`session:${id}`); await this.redis.srem("sessions:active", id); }
  async authorize(id: string, token: string) { const session = await this.get(id); return session && tokenMatches(session.tokenHash, token) ? session : null; }
  async claimConfirmation(id: string, confirmation: ConfirmProcessingRequest) {
    const result = await this.redis.eval(claimConfirmationScript, 1, `session:${id}`, JSON.stringify(confirmation), hashConfirmation(confirmation)) as string;
    return result as "CLAIMED" | "SAME" | "CONFLICT" | "MISSING";
  }
  async claimProcessing(id: string, attemptId: string) { const result = await this.redis.eval(claimProcessingScript, 1, `session:${id}`, attemptId); if (result === 0) return { claimed: false as const }; return { claimed: true as const, generation: Number(result) }; }
  async markClosed(id: string, status: "CANCELLED" | "EXPIRED") { const value = await this.redis.eval(markClosedScript, 1, `session:${id}`, status) as string | null; return value ? deserializeSession(value) : null; }
  async touchHeartbeat(id: string, at: string) { return await this.redis.eval(touchHeartbeatScript, 1, `session:${id}`, at) === 1; }
  async complete(session: ReconciliationSession) {
    const ttl = Math.max(1, new Date(session.expiresAt).getTime() - Date.now());
    return await this.redis.eval(completeSessionScript, 2, `session:${session.id}`, `session:deleted:${session.id}`, JSON.stringify(session), ttl) === 1;
  }
  async countActive(clientKey: string) { const ids = await this.redis.smembers("sessions:active"); let count = 0; for (const id of ids) { const item = await this.get(id); if (item?.clientKey === clientKey && !item.closed && !["CANCELLED", "EXPIRED"].includes(item.status)) count += 1; } return count; }
  async countCreatedLastHour(clientKey: string) { const key = `rate:create:${clientKey}`; const cutoff = Date.now() - 3_600_000; await this.redis.zremrangebyscore(key, 0, cutoff); return this.redis.zcard(key); }
  async markCreated(clientKey: string) { const key = `rate:create:${clientKey}`; await this.redis.zadd(key, Date.now(), `${Date.now()}:${randomBytes(4).toString("hex")}`); await this.redis.expire(key, 3600); }
  async listExpired(now: Date) { const ids = await this.redis.smembers("sessions:active"); const expired: ReconciliationSession[] = []; for (const id of ids) { const item = await this.get(id); if (!item) { await this.redis.srem("sessions:active", id); continue; } if (new Date(item.expiresAt) <= now || now.getTime() - new Date(item.lastHeartbeatAt).getTime() > this.config.heartbeatGraceSeconds * 1000) expired.push(item); } return expired; }
  async close(): Promise<void> {
    try {
      if (this.redis.status !== "end") await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}

export function createSessionStore(config: RuntimeConfig): SessionStore {
  return config.redisUrl ? new RedisSessionStore(config) : new MemorySessionStore(config);
}

export function publicSession(session: ReconciliationSession): PublicSession {
  const { tokenHash: _tokenHash, clientKey: _clientKey, actorId: _actorId, organizationId: _organizationId, ledgers: _ledgers, statements: _statements, investments: _investments, confirmation: _confirmation, confirmationHash: _confirmationHash, processingAttemptId: _processingAttemptId, processingGeneration: _processingGeneration, ...safe } = session;
  return safe;
}

function hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function tokenMatches(expected: string, token: string): boolean { const actual = hashToken(token); return expected.length === actual.length && timingSafeEqual(Buffer.from(expected), Buffer.from(actual)); }
function hashConfirmation(confirmation: ConfirmProcessingRequest): string { return createHash("sha256").update(JSON.stringify(confirmation)).digest("hex"); }

function mergeSession(current: ReconciliationSession, incoming: ReconciliationSession): ReconciliationSession {
  if (current.closed) return structuredClone(current);
  if (isSuccessfulTerminal(current.status)) {
    if (incoming.status === current.status && incoming.result) {
      const updated = structuredClone(current);
      updated.result = structuredClone(incoming.result);
      return updated;
    }
    return structuredClone(current);
  }
  if (current.processingAttemptId && current.processingAttemptId !== incoming.processingAttemptId) return structuredClone(current);
  const merged = structuredClone(incoming);
  if (current.confirmation) {
    merged.confirmation = structuredClone(current.confirmation);
    if (current.confirmationHash) merged.confirmationHash = current.confirmationHash;
    else delete merged.confirmationHash;
  }
  if (statusRank(current) > statusRank(incoming)) {
    merged.closed = current.closed;
    merged.status = current.status;
    merged.progress = current.progress;
    merged.progressMessage = current.progressMessage;
    if (current.pendingAction) merged.pendingAction = current.pendingAction;
    else delete merged.pendingAction;
    if (current.result) merged.result = structuredClone(current.result);
  }
  return merged;
}

function isSuccessfulTerminal(status: ReconciliationSession["status"]): boolean {
  return status === "COMPLETED" || status === "COMPLETED_WITH_ISSUES";
}

function statusRank(session: { status: ReconciliationSession["status"]; pendingAction?: string }): number {
  if (session.status === "QUEUED") {
    return session.pendingAction === "PROCESS" ? 5 : 3;
  }
  return {
    DRAFT: 0, UPLOADING: 1, READY: 2, PREFLIGHT: 3, AWAITING_CONFIRMATION: 4,
    VALIDATING: 6, EXTRACTING: 6, OCR_PROCESSING: 6, RECONCILING: 7,
    COMPLETED: 8, COMPLETED_WITH_ISSUES: 8, FAILED: 8, CANCELLING: 9,
    CANCELLED: 10, EXPIRED: 10,
  }[session.status] ?? 0;
}

function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function deserializeSession(raw: string): ReconciliationSession {
  const session = JSON.parse(raw) as ReconciliationSession;
  session.files = ensureArray(session.files);
  if (session.ledgers) session.ledgers = ensureArray(session.ledgers);
  if (session.statements) session.statements = ensureArray(session.statements);
  if (session.investments) session.investments = ensureArray(session.investments);
  if (session.preflight) {
    session.preflight.companies = ensureArray(session.preflight.companies);
    session.preflight.branches = ensureArray(session.preflight.branches);
    session.preflight.detectedPeriods = ensureArray(session.preflight.detectedPeriods);
    session.preflight.ledgerAccounts = ensureArray(session.preflight.ledgerAccounts);
    session.preflight.statements = ensureArray(session.preflight.statements);
    session.preflight.investments = ensureArray(session.preflight.investments);
    session.preflight.issues = ensureArray(session.preflight.issues);
  }
  if (session.confirmation?.mappings) {
    session.confirmation.mappings = ensureArray<ConfirmProcessingRequest["mappings"][number]>(
      session.confirmation.mappings,
    ).map((mapping) => ({
      ...mapping,
      statementFileIds: ensureArray<string>(mapping.statementFileIds),
    }));
  }
  if (session.result) {
    session.result.results = ensureArray(session.result.results);
    session.result.issues = ensureArray(session.result.issues);
  }
  return session;
}

const saveSessionScript = `
pcall(cjson.encode_empty_table_as_object, false)
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
local incoming = cjson.decode(ARGV[1])
local value = redis.call('GET', KEYS[1])
if value then
  local current = cjson.decode(value)
  if current.closed then return 0 end
  if current.status == 'COMPLETED' or current.status == 'COMPLETED_WITH_ISSUES' then
    if incoming.status == current.status and incoming.result then
      current.result = incoming.result
      redis.call('PSETEX', KEYS[1], ARGV[2], cjson.encode(current))
      return 1
    end
    return 0
  end
  if current.processingAttemptId and current.processingAttemptId ~= incoming.processingAttemptId then return 0 end
  if current.confirmation then
    incoming.confirmation = current.confirmation
    incoming.confirmationHash = current.confirmationHash
  end
  local function get_rank(sess)
    if sess.status == 'QUEUED' then
      if sess.pendingAction == 'PROCESS' then return 5 else return 3 end
    end
    local ranks = {
      DRAFT=0, UPLOADING=1, READY=2, PREFLIGHT=3, AWAITING_CONFIRMATION=4,
      VALIDATING=6, EXTRACTING=6, OCR_PROCESSING=6, RECONCILING=7,
      COMPLETED=8, COMPLETED_WITH_ISSUES=8, FAILED=8, CANCELLING=9,
      CANCELLED=10, EXPIRED=10
    }
    return ranks[sess.status] or 0
  end
  if get_rank(current) > get_rank(incoming) then
    incoming.closed = current.closed
    incoming.status = current.status
    incoming.progress = current.progress
    incoming.progressMessage = current.progressMessage
    incoming.pendingAction = current.pendingAction
    incoming.result = current.result
  end
end
redis.call('PSETEX', KEYS[1], ARGV[2], cjson.encode(incoming))
redis.call('SADD', 'sessions:active', incoming.id)
return 1
`;

const claimProcessingScript = `
pcall(cjson.encode_empty_table_as_object, false)
local value = redis.call('GET', KEYS[1])
if not value then return 0 end
local session = cjson.decode(value)
if session.closed or session.status == 'COMPLETED' or session.status == 'COMPLETED_WITH_ISSUES' then return 0 end
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then return 0 end
local generation = (session.processingGeneration or 0) + 1
session.processingAttemptId = ARGV[1]
session.processingGeneration = generation
redis.call('PSETEX', KEYS[1], ttl, cjson.encode(session))
return generation
`;

const markClosedScript = `
pcall(cjson.encode_empty_table_as_object, false)
local value = redis.call('GET', KEYS[1])
if not value then return nil end
local session = cjson.decode(value)
session.closed = true
session.status = ARGV[1]
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then return nil end
local encoded = cjson.encode(session)
redis.call('PSETEX', KEYS[1], ttl, encoded)
return encoded
`;

const claimConfirmationScript = `
pcall(cjson.encode_empty_table_as_object, false)
local value = redis.call('GET', KEYS[1])
if not value then return 'MISSING' end
local session = cjson.decode(value)
local incoming = cjson.decode(ARGV[1])
if session.confirmation then
  if session.confirmationHash == ARGV[2] then return 'SAME' end
  return 'CONFLICT'
end
session.confirmation = incoming
session.confirmationHash = ARGV[2]
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then return 'MISSING' end
redis.call('PSETEX', KEYS[1], ttl, cjson.encode(session))
return 'CLAIMED'
`;

const touchHeartbeatScript = `
local value = redis.call('GET', KEYS[1])
if not value then return 0 end
local session = cjson.decode(value)
if session.closed then return 0 end
session.lastHeartbeatAt = ARGV[1]
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then return 0 end
redis.call('PSETEX', KEYS[1], ttl, cjson.encode(session))
return 1
`;

const completeSessionScript = `
pcall(cjson.encode_empty_table_as_object, false)
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
local value = redis.call('GET', KEYS[1])
if not value then return 0 end
local current = cjson.decode(value)
if current.closed then return 0 end
local incoming = cjson.decode(ARGV[1])
if incoming.processingAttemptId and current.processingAttemptId ~= incoming.processingAttemptId then return 0 end
redis.call('PSETEX', KEYS[1], ARGV[2], cjson.encode(incoming))
return 1
`;
