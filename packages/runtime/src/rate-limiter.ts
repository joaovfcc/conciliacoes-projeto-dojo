import { createHmac } from "node:crypto";
import Redis from "ioredis";

export interface RateLimitPolicy {
  name: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(policy: RateLimitPolicy, rawKey: string): Promise<RateLimitResult>;
}

const consumeScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

export class RedisRateLimiter implements RateLimiter {
  private readonly redis: Redis;

  constructor(redisUrl: string, private readonly keySecret: string) {
    if (keySecret.length < 32) throw new Error("RATE_LIMIT_KEY_SECRET deve possuir ao menos 32 caracteres");
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: true });
  }

  async consume(policy: RateLimitPolicy, rawKey: string): Promise<RateLimitResult> {
    if (this.redis.status === "wait") await this.redis.connect();
    const key = `rate:${policy.name}:${this.hash(rawKey)}`;
    const [count, ttl] = await this.redis.eval(consumeScript, 1, key, policy.windowMs) as [number, number];
    return {
      allowed: count <= policy.limit,
      remaining: Math.max(0, policy.limit - count),
      retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)),
    };
  }

  async close(): Promise<void> {
    try {
      if (this.redis.status !== "end") await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  private hash(value: string): string {
    return createHmac("sha256", this.keySecret).update(value).digest("hex");
  }
}
