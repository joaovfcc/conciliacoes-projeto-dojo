import { describe, expect, it } from "vitest";
import { RedisRateLimiter } from "../../src/rate-limiter";

describe("RedisRateLimiter", () => {
  it("requires a strong key secret before accepting identifiers", () => {
    expect(() => new RedisRateLimiter("redis://localhost:6379", "short")).toThrow(
      "RATE_LIMIT_KEY_SECRET deve possuir ao menos 32 caracteres",
    );
  });
});
